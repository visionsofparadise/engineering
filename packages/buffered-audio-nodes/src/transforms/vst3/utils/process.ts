import { spawn, type ChildProcess } from "node:child_process";
import { deinterleaveBuffer, interleave } from "@e9g/buffered-audio-nodes-utils";
import { waitForDrain } from "../../../utils/ffmpeg";

export interface VstHostHandle {
	readonly proc: ChildProcess;
	readonly stdin: NodeJS.WritableStream;
	readonly stdout: NodeJS.ReadableStream;
	readonly stderr: NodeJS.ReadableStream;
	readonly ready: Promise<void>;
	readonly stderrChunks: Array<Buffer>;
}

const READY_LINE = "READY\n";
const READY_TIMEOUT_MS = 30_000;

/**
 * Spawn the vst-host subprocess and resolve `ready` once the wrapper prints
 * `READY\n` on stdout. Stderr is captured into `stderrChunks` for diagnostics.
 *
 * The caller is responsible for awaiting `ready` before writing to stdin —
 * without that, the first write may race the plugin load.
 */
export function spawnVstHost(binaryPath: string, args: ReadonlyArray<string>): VstHostHandle {
	const proc: ChildProcess = spawn(binaryPath, [...args], {
		stdio: ["pipe", "pipe", "pipe"],
	});

	if (!proc.stdin || !proc.stdout || !proc.stderr) {
		throw new Error("Failed to create vst-host stdio streams");
	}

	const stdin = proc.stdin;
	const stdout = proc.stdout;
	const stderr = proc.stderr;
	const stderrChunks: Array<Buffer> = [];

	stderr.on("data", (chunk: Buffer) => {
		stderrChunks.push(chunk);
	});

	const ready = new Promise<void>((resolve, reject) => {
		// Buffer stdout bytes until we see `READY\n`. Anything after the newline
		// belongs to the audio stream and must be preserved — push it back as a
		// synthetic `data` event so downstream readers see it.
		const seen: Array<Buffer> = [];

		const cleanup = (): void => {
			stdout.removeListener("data", onData);
			proc.removeListener("error", onError);
			proc.removeListener("close", onClose);
			clearTimeout(timer);
		};

		const fail = (error: Error): void => {
			cleanup();
			reject(error);
		};

		const onData = (chunk: Buffer): void => {
			seen.push(chunk);

			const combined = Buffer.concat(seen);
			const readyIndex = combined.indexOf(READY_LINE);

			if (readyIndex === -1) return;

			cleanup();

			const tail = combined.subarray(readyIndex + READY_LINE.length);

			if (tail.length > 0) {
				// Re-emit any bytes received after `READY\n` so the audio reader
				// sees them. Use queueMicrotask to avoid re-entering the listener
				// chain mid-emit.
				queueMicrotask(() => {
					stdout.emit("data", tail);
				});
			}

			resolve();
		};

		const onError = (error: Error): void => {
			fail(new Error(`vst-host failed to start: ${error.message}`));
		};

		const onClose = (code: number | null): void => {
			const stderrOutput = Buffer.concat(stderrChunks).toString();

			fail(new Error(`vst-host exited before READY (code ${code ?? "null"}): ${stderrOutput}`));
		};

		const timer = setTimeout(() => {
			fail(new Error(`vst-host did not emit READY within ${READY_TIMEOUT_MS}ms`));
		}, READY_TIMEOUT_MS);

		stdout.on("data", onData);
		proc.once("error", onError);
		proc.once("close", onClose);
	});

	// Swallow EPIPE on stdin — the subprocess may exit before we finish writing.
	stdin.on("error", () => {
		// Captured in stderr / exit code paths.
	});

	return { proc, stdin, stdout, stderr, ready, stderrChunks };
}

/**
 * Synchronous queue of stdout bytes. Each call to `take(n)` resolves once at
 * least `n` bytes have accumulated; the first `n` are removed and returned.
 *
 * This is required because Node stdio is OS-chunked — a single write may
 * surface as multiple `data` events, or multiple writes may coalesce into one.
 * Always accumulate.
 */
export class StdoutByteQueue {
	private chunks: Array<Buffer> = [];
	private size = 0;
	private waiter?: { bytes: number; resolve: () => void };
	private closed = false;
	private closeError?: Error;

	constructor(stdout: NodeJS.ReadableStream) {
		stdout.on("data", (chunk: Buffer) => {
			this.chunks.push(chunk);
			this.size += chunk.length;
			this.maybeResolveWaiter();
		});

		stdout.on("end", () => {
			this.closed = true;
			this.maybeResolveWaiter();
		});
	}

	closeWithError(error: Error): void {
		this.closeError = error;
		this.closed = true;
		this.maybeResolveWaiter();
	}

	private maybeResolveWaiter(): void {
		if (!this.waiter) return;

		if (this.size >= this.waiter.bytes || this.closed) {
			const { resolve } = this.waiter;

			this.waiter = undefined;
			resolve();
		}
	}

	async take(bytes: number, timeoutMs: number): Promise<Buffer> {
		if (this.size < bytes && !this.closed) {
			await new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => {
					this.waiter = undefined;
					reject(new Error(`vst-host stdout read timed out after ${timeoutMs}ms (waiting for ${bytes} bytes, have ${this.size})`));
				}, timeoutMs);

				this.waiter = {
					bytes,
					resolve: () => {
						clearTimeout(timer);
						resolve();
					},
				};
			});
		}

		if (this.closeError) throw this.closeError;

		if (this.size < bytes) {
			throw new Error(`vst-host stdout closed before delivering ${bytes} bytes (had ${this.size})`);
		}

		const combined = Buffer.concat(this.chunks);

		this.chunks = [combined.subarray(bytes)];
		this.size = combined.length - bytes;

		return combined.subarray(0, bytes);
	}
}

/**
 * Process one block of channel arrays through the vst-host subprocess:
 * 1. Interleave channel arrays to f32le bytes.
 * 2. Write to stdin with drain-event backpressure.
 * 3. Read exactly `frames * channels * 4` bytes from stdout via the queue.
 * 4. Deinterleave back to per-channel arrays.
 *
 * The subprocess MUST be in the `READY` state when this is called.
 */
export async function processChunkThroughVstHost(
	handle: VstHostHandle,
	queue: StdoutByteQueue,
	channels: Array<Float32Array>,
	frames: number,
	channelCount: number,
): Promise<Array<Float32Array>> {
	const expectedBytes = frames * channelCount * 4;

	const interleaved = interleave(channels, frames, channelCount);
	const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

	const canWrite = handle.stdin.write(buf);

	if (!canWrite) {
		await waitForDrain(handle.proc, handle.stdin);
	}

	// Generous timeout: 10ms per frame is ~10x typical processing time even
	// for heavy plugins at 48kHz, plus a 1s floor for short blocks.
	const timeoutMs = Math.max(1000, frames * 10);
	const outputBuf = await queue.take(expectedBytes, timeoutMs);

	return deinterleaveBuffer(outputBuf, channelCount);
}
