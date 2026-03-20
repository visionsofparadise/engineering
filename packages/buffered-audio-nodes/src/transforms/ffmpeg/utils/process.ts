import { spawn, type ChildProcess } from "node:child_process";
import type { ChunkBuffer } from "../../../buffer";
import { waitForDrain } from "../../../utils/ffmpeg";
import { deinterleaveBuffer, interleave } from "../../../utils/interleave";

export function runFfmpegWithFile(binaryPath: string, args: Array<string>, channels: number): Promise<Array<Float32Array>> {
	return new Promise<Array<Float32Array>>((resolve, reject) => {
		const proc: ChildProcess = spawn(binaryPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (!proc.stdout || !proc.stderr) {
			reject(new Error("Failed to create ffmpeg stdio streams"));

			return;
		}

		const outputChunks: Array<Buffer> = [];
		const stderrChunks: Array<Buffer> = [];

		proc.stdout.on("data", (chunk: Buffer) => {
			outputChunks.push(chunk);
		});

		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				const stderrOutput = Buffer.concat(stderrChunks).toString();

				reject(new Error(`ffmpeg exited with code ${code}: ${stderrOutput}`));

				return;
			}

			const outputBuffer = Buffer.concat(outputChunks);
			const samples = deinterleaveBuffer(outputBuffer, channels);

			resolve(samples);
		});
	});
}

export function runFfmpeg(binaryPath: string, args: Array<string>, buffer: ChunkBuffer, channels: number): Promise<Array<Float32Array>> {
	return new Promise<Array<Float32Array>>((resolve, reject) => {
		const proc: ChildProcess = spawn(binaryPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (!proc.stdout || !proc.stderr || !proc.stdin) {
			reject(new Error("Failed to create ffmpeg stdio streams"));

			return;
		}

		const stdout = proc.stdout;
		const stderr = proc.stderr;
		const stdin = proc.stdin;

		const outputChunks: Array<Buffer> = [];
		const stderrChunks: Array<Buffer> = [];

		stdout.on("data", (chunk: Buffer) => {
			outputChunks.push(chunk);
		});

		stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				const stderrOutput = Buffer.concat(stderrChunks).toString();

				reject(new Error(`ffmpeg exited with code ${code}: ${stderrOutput}`));

				return;
			}

			const outputBuffer = Buffer.concat(outputChunks);
			const samples = deinterleaveBuffer(outputBuffer, channels);

			resolve(samples);
		});

		stdin.on("error", () => {
			// Ignore EPIPE/EOF — expected when filters like trim close stdin early
		});

		void writeBufferToStdin(proc, stdin, buffer).catch(() => {
			// Ignore write errors — ffmpeg may close stdin before all data is written
		});
	});
}

export async function writeBufferToStdin(proc: ChildProcess, stdin: NodeJS.WritableStream, buffer: ChunkBuffer): Promise<void> {
	const chunkSize = 44100;

	for await (const chunk of buffer.iterate(chunkSize)) {
		const interleaved = interleave(chunk.samples, chunk.samples[0]?.length ?? 0, chunk.samples.length);
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		const canWrite = stdin.write(buf);

		if (!canWrite) {
			await waitForDrain(proc, stdin);
		}
	}

	stdin.end();
}
