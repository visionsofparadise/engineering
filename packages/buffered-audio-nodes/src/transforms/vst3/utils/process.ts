import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

export interface VstStage {
	readonly pluginPath: string;
	readonly pluginName?: string;
	readonly presetPath?: string;
	/**
	 * Optional parameter overrides applied after `presetPath` loads. Keys map
	 * to Pedalboard parameter names exposed by the plugin (lowercase / snake-
	 * cased identifiers — see `plugin.parameters` in Pedalboard). Useful for
	 * plugins whose on-disk preset format Pedalboard's `load_preset` rejects
	 * (e.g. Waves XPst inside a VST3 wrapper) but whose parameter surface is
	 * reachable directly.
	 */
	readonly parameters?: Readonly<Record<string, number | string | boolean>>;
}

const READY_LINE = "READY\n";
// 5-minute floor accommodates chains of heavy plugins (iZotope RX, Waves
// shells, Neutron) where each plugin's instantiation can take several
// seconds. Empirically a 7-plugin chain of those vendors loads in ~60s on
// a warm Windows box; the floor is generous to absorb cold-start variance
// and authorization checks. The READY signal is bounded by plugin-load
// cost, not audio length, so a single conservative cap is appropriate.
const READY_TIMEOUT_MS = 300_000;

/**
 * Spawn the vst-host subprocess and resolve `ready` once the wrapper prints
 * `READY\n` on stdout. Stderr is captured into `stderrChunks` for diagnostics.
 *
 * The caller is responsible for awaiting `ready` before writing audio to
 * stdin — without that, the first write may race the plugin chain load.
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

	stdin.on("error", () => {
		// EPIPE swallowed; surfaced via stderr / exit code.
	});

	return { proc, stdin, stdout, stderr, ready, stderrChunks };
}

/**
 * Write `stages` as JSON to a fresh temp file. Returns the file path and an
 * async cleanup function that removes the parent temp directory.
 */
export async function writeStagesJson(stages: ReadonlyArray<VstStage>): Promise<{ path: string; cleanup: () => Promise<void> }> {
	const dir = await mkdtemp(join(tmpdir(), "vst-host-stages-"));
	const path = join(dir, "stages.json");

	await writeFile(path, JSON.stringify(stages));

	return {
		path,
		cleanup: async () => {
			await rm(dir, { recursive: true, force: true });
		},
	};
}

/**
 * Run the entire audio buffer through the vst-host subprocess in offline mode:
 * 1. Interleave channel arrays to f32le bytes.
 * 2. Write to stdin and close stdin (signals "no more input" to the wrapper).
 * 3. Concatenate all stdout bytes until the wrapper closes its stdout.
 * 4. Wait for the subprocess to exit; surface stderr on non-zero exit.
 * 5. Deinterleave back to per-channel arrays.
 *
 * Pedalboard's offline mode (`reset=True`) inside the wrapper handles plugin
 * delay compensation across the whole chain, so the returned channels have
 * the same frame count as the input.
 */
export async function processWholeFileThroughVstHost(
	handle: VstHostHandle,
	channels: Array<Float32Array>,
	frames: number,
	channelCount: number,
): Promise<Array<Float32Array>> {
	const interleaved = interleave(channels, frames, channelCount);
	const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

	// Drain stdout into a chunks array until the subprocess closes its stdout.
	// We don't block on a fixed byte count — Pedalboard's offline mode returns
	// the same frame count as input, so the wrapper writes
	// `frames * channelCount * 4` bytes and then closes stdout on exit.
	const stdoutChunks: Array<Buffer> = [];

	handle.stdout.on("data", (chunk: Buffer) => {
		stdoutChunks.push(chunk);
	});

	const stdoutEnd = new Promise<void>((resolve) => {
		handle.stdout.once("end", () => resolve());
	});

	const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		handle.proc.once("close", (code, signal) => resolve({ code, signal }));
	});

	const canWrite = handle.stdin.write(buf);

	if (!canWrite) {
		await waitForDrain(handle.proc, handle.stdin);
	}

	handle.stdin.end();

	await stdoutEnd;
	const exit = await exited;

	if (exit.code !== 0) {
		const stderrOutput = Buffer.concat(handle.stderrChunks).toString();

		throw new Error(`vst-host exited with code ${exit.code ?? "null"}${exit.signal ? ` (signal ${exit.signal})` : ""}: ${stderrOutput}`);
	}

	const expectedBytes = frames * channelCount * 4;
	const outputBuf = Buffer.concat(stdoutChunks);

	if (outputBuf.length !== expectedBytes) {
		throw new Error(`vst-host returned ${outputBuf.length} bytes, expected ${expectedBytes} (${frames} frames × ${channelCount} channels × 4)`);
	}

	return deinterleaveBuffer(outputBuf, channelCount);
}
