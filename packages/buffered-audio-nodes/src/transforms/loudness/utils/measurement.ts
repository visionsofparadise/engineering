import { spawn } from "node:child_process";
import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { interleave } from "@e9g/buffered-audio-nodes-utils";
import type { LoudnessProperties } from "..";

export async function measureLoudness(
	buffer: ChunkBuffer,
	sampleRate: number,
	channels: number,
	properties: LoudnessProperties,
): Promise<{
	inputI: string;
	inputTp: string;
	inputLra: string;
	inputThresh: string;
	targetOffset: string;
}> {
	const binaryPath = properties.ffmpegPath;

	const parts = [`I=${properties.target}`, `TP=${properties.truePeak}`, properties.lra !== undefined ? `LRA=${properties.lra}` : "", "print_format=json"].filter(Boolean);

	const args = ["-f", "f32le", "-ar", String(sampleRate), "-ac", String(channels), "-i", "pipe:0", "-af", `loudnorm=${parts.join(":")}`, "-f", "null", "-"];

	return new Promise((resolve, reject) => {
		const proc = spawn(binaryPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdin = proc.stdin;
		const stderrStream = proc.stderr;

		const stderrChunks: Array<Buffer> = [];

		stderrStream.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
		});

		proc.on("close", (code) => {
			const stderr = Buffer.concat(stderrChunks).toString();

			if (code !== 0) {
				reject(new Error(`ffmpeg measurement pass exited with code ${code}: ${stderr}`));

				return;
			}

			const jsonMatch = /\{[^}]*"input_i"[^}]*\}/s.exec(stderr);

			if (!jsonMatch) {
				reject(new Error("Failed to parse loudnorm measurement output"));

				return;
			}

			const measured = JSON.parse(jsonMatch[0]) as Record<string, string>;

			resolve({
				inputI: measured.input_i ?? "0",
				inputTp: measured.input_tp ?? "0",
				inputLra: measured.input_lra ?? "0",
				inputThresh: measured.input_thresh ?? "0",
				targetOffset: measured.target_offset ?? "0",
			});
		});

		void writeToStdin(stdin, buffer, channels);
	});
}

export async function writeToStdin(stdin: NodeJS.WritableStream, buffer: ChunkBuffer, channels: number): Promise<void> {
	for await (const chunk of buffer.iterate(44100)) {
		const interleaved = interleave(chunk.samples, chunk.samples[0]?.length ?? 0, channels);
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		const canWrite = stdin.write(buf);

		if (!canWrite) {
			await new Promise<void>((resolve) => {
				stdin.once("drain", resolve);
			});
		}
	}

	stdin.end();
}
