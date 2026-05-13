import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { deinterleaveBuffer, interleave } from "./interleave";

/**
 * Streaming ffmpeg-backed resampler.
 *
 * Spawns one `ffmpeg` subprocess and exposes it as a writer/reader pair:
 *
 * 1. `write(samples)` interleaves and writes raw `f32le` PCM to ffmpeg's
 *    stdin, awaiting `drain` if the kernel pipe fills.
 * 2. `read(frames)` returns up to `frames` of deinterleaved `f32le` PCM
 *    from stdout. The returned per-channel `Float32Array[]` has
 *    `length <= frames`; a length of `0` signals end-of-stream (after
 *    `end()` was called and ffmpeg drained its tail). A short non-zero
 *    return is normal while the resampler's internal buffering is in
 *    flight — callers loop until they've accumulated what they need.
 *    `read` blocks only when no data is currently available AND stdout
 *    has not yet ended.
 * 3. `end()` closes stdin so ffmpeg can emit its tail and exit; `read()`
 *    may then be called repeatedly until it returns a short chunk to
 *    drain the tail.
 * 4. `close()` is idempotent and always safe — it kills the subprocess
 *    if still running and unhooks listeners. Call from `finally` so an
 *    error in the surrounding pipeline never orphans the child.
 *
 * Designed for the **concurrent in-place segment streaming** pattern in
 * `htdemucs` / `kim-vocal-2`: the caller spawns one `ResampleStream` for
 * input (sourceRate → 44 100) and one for output (44 100 → sourceRate),
 * interleaving `write` and `read` calls in lockstep with the segment
 * loop. The internal stdout listener drains ffmpeg's stdout into an
 * in-memory queue concurrently with the caller's writes, preventing the
 * classic write-stdin-without-reading-stdout deadlock.
 */

const STDERR_CAP_BYTES = 64 * 1024;

interface PendingRead {
	readonly resolve: (value: Array<Float32Array>) => void;
	readonly reject: (error: Error) => void;
	readonly frames: number;
}

export interface ResampleStreamOptions {
	readonly sourceSampleRate: number;
	readonly targetSampleRate: number;
	readonly channels: number;
}

export class ResampleStream {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly channels: number;
	private readonly bytesPerFrame: number;
	private readonly chunks: Array<Buffer> = [];
	private chunkedBytes = 0;
	private pendingDrain?: Promise<void>;
	private stdoutEnded = false;
	private exited = false;
	private exitError?: Error;
	private stderr = "";
	private pendingRead?: PendingRead;
	private closed = false;

	constructor(ffmpegPath: string, options: ResampleStreamOptions) {
		const { sourceSampleRate, targetSampleRate, channels } = options;

		if (channels <= 0) throw new Error(`ResampleStream: channels must be > 0, got ${String(channels)}`);
		if (sourceSampleRate <= 0) throw new Error(`ResampleStream: sourceSampleRate must be > 0, got ${String(sourceSampleRate)}`);
		if (targetSampleRate <= 0) throw new Error(`ResampleStream: targetSampleRate must be > 0, got ${String(targetSampleRate)}`);

		this.channels = channels;
		this.bytesPerFrame = channels * 4;

		const args = [
			"-f", "f32le",
			"-ar", String(sourceSampleRate),
			"-ac", String(channels),
			"-i", "pipe:0",
			"-af", `aresample=${String(targetSampleRate)}:resampler=soxr:dither_method=triangular`,
			"-f", "f32le",
			"-ar", String(targetSampleRate),
			"-ac", String(channels),
			"pipe:1",
		];

		this.child = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });

		this.child.stdout.on("data", (bytes: Buffer) => this.onStdoutData(bytes));
		this.child.stdout.once("end", () => this.onStdoutEnd());
		this.child.stderr.on("data", (bytes: Buffer) => this.onStderrData(bytes));
		this.child.on("error", (error) => this.onExit(error));
		this.child.once("exit", (code) => {
			if (code !== null && code !== 0) {
				const detail = this.stderr ? `: ${this.stderr.slice(0, 1024)}` : "";

				this.onExit(new Error(`ffmpeg exited ${String(code)}${detail}`));

				return;
			}

			this.onExit();
		});
		this.child.stdin.on("error", (error: Error & { code?: string }) => {
			// EPIPE is expected when ffmpeg exits early; surface other errors via the
			// stdin-write path or via `close()` if no caller is currently writing.
			if (error.code === "EPIPE") return;
			this.exitError ??= error;
		});
	}

	async write(samples: Array<Float32Array>): Promise<void> {
		if (this.closed) throw new Error("ResampleStream: write after close");
		if (this.exitError) throw this.exitError;

		const frames = samples[0]?.length ?? 0;

		if (frames === 0) return;

		const interleaved = interleave(samples, frames, this.channels);
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		if (this.pendingDrain) await this.pendingDrain;

		const ok = this.child.stdin.write(buf);

		if (!ok) {
			this.pendingDrain = new Promise<void>((resolve) => {
				this.child.stdin.once("drain", () => {
					this.pendingDrain = undefined;
					resolve();
				});
			});
		}
	}

	async read(frames: number): Promise<Array<Float32Array>> {
		if (this.closed) throw new Error("ResampleStream: read after close");
		if (frames <= 0) return this.emptyChannels();
		if (this.pendingRead) throw new Error("ResampleStream: concurrent read");

		// Fast path: any complete frame is available — return immediately with
		// up to `frames` of it. Callers loop to accumulate more.
		if (this.chunkedBytes >= this.bytesPerFrame) return this.drainOutput(frames);

		if (this.exitError) throw this.exitError;

		// No data buffered. If ffmpeg has finished and stdout is closed, return
		// a zero-length chunk to signal end-of-stream.
		if (this.stdoutEnded && this.exited) return this.emptyChannels();

		return new Promise<Array<Float32Array>>((resolve, reject) => {
			this.pendingRead = { resolve, reject, frames };
			this.maybeSatisfyPendingRead();
		});
	}

	async end(): Promise<void> {
		if (this.closed) return;
		if (this.pendingDrain) await this.pendingDrain;
		if (!this.child.stdin.writableEnded) this.child.stdin.end();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;

		if (this.pendingRead) {
			this.pendingRead.reject(new Error("ResampleStream: close while read pending"));
			this.pendingRead = undefined;
		}

		try {
			if (!this.child.stdin.writableEnded) {
				try {
					this.child.stdin.end();
				} catch {
					// Ignore — already ended or broken pipe.
				}
			}
		} finally {
			if (!this.exited && this.child.exitCode === null && !this.child.killed) {
				this.child.kill("SIGTERM");
			}
		}

		// Wait for the child to fully exit so the temp resources release. Wrap in a
		// best-effort timer so a stuck subprocess can't hang the pipeline tear-down.
		if (!this.exited) {
			await new Promise<void>((resolve) => {
				let settled = false;
				const settle = (): void => {
					if (!settled) {
						settled = true;
						resolve();
					}
				};
				const timeout = setTimeout(() => {
					this.child.kill("SIGKILL");
					settle();
				}, 5000);

				this.child.once("exit", () => {
					clearTimeout(timeout);
					settle();
				});
			});
		}
	}

	private onStdoutData(bytes: Buffer): void {
		if (bytes.length > 0) {
			this.chunks.push(bytes);
			this.chunkedBytes += bytes.length;
		}

		this.maybeSatisfyPendingRead();
	}

	private onStdoutEnd(): void {
		this.stdoutEnded = true;
		this.maybeSatisfyPendingRead();
	}

	private onStderrData(bytes: Buffer): void {
		if (this.stderr.length >= STDERR_CAP_BYTES) return;

		const remaining = STDERR_CAP_BYTES - this.stderr.length;
		const text = bytes.toString("utf8");

		this.stderr += text.length > remaining ? text.slice(0, remaining) : text;
	}

	private onExit(error?: Error): void {
		this.exited = true;
		if (error) this.exitError ??= error;
		this.maybeSatisfyPendingRead();
	}

	private maybeSatisfyPendingRead(): void {
		if (!this.pendingRead) return;

		const { frames, resolve, reject } = this.pendingRead;

		// Any complete frame available — satisfy the read immediately. The
		// caller loops if it wants more.
		if (this.chunkedBytes >= this.bytesPerFrame) {
			this.pendingRead = undefined;
			resolve(this.drainOutput(frames));

			return;
		}

		if (this.stdoutEnded && this.exited) {
			this.pendingRead = undefined;

			if (this.exitError) {
				reject(this.exitError);

				return;
			}

			// No data left to read — signal end-of-stream with an empty chunk.
			resolve(this.emptyChannels());
		}
	}

	private drainOutput(frames: number): Array<Float32Array> {
		const wantBytes = frames * this.bytesPerFrame;
		const available = Math.min(this.chunkedBytes, wantBytes);
		const completeFrames = Math.floor(available / this.bytesPerFrame);

		if (completeFrames === 0) return this.emptyChannels();

		const completeBytes = completeFrames * this.bytesPerFrame;
		const aligned = Buffer.allocUnsafe(completeBytes);
		let written = 0;

		while (written < completeBytes) {
			const head = this.chunks[0];

			if (!head) break;

			const remaining = completeBytes - written;

			if (head.length <= remaining) {
				head.copy(aligned, written, 0, head.length);
				written += head.length;
				this.chunks.shift();
				continue;
			}

			head.copy(aligned, written, 0, remaining);
			this.chunks[0] = head.subarray(remaining);
			written += remaining;
		}

		this.chunkedBytes -= completeBytes;

		return deinterleaveBuffer(aligned, this.channels);
	}

	private emptyChannels(): Array<Float32Array> {
		const out: Array<Float32Array> = [];

		for (let ch = 0; ch < this.channels; ch++) out.push(new Float32Array(0));

		return out;
	}
}
