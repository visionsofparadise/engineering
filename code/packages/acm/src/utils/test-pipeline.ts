import { randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WaveFile } from "wavefile";
import { ChunkBuffer } from "../chunk-buffer";
import type { StreamMeta } from "../module";
import { read } from "../sources/read";
import type { WavBitDepth } from "../targets/write";
import { write } from "../targets/write";
import type { TransformModule } from "../transform";

export interface TransformTestResult {
	readonly input: Array<Float32Array>;
	readonly output: Array<Float32Array>;
	readonly context: StreamMeta;
}

async function readToBuffer(path: string): Promise<{ buffer: ChunkBuffer; context: StreamMeta }> {
	const data = await readFile(path);
	const wav = new WaveFile(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	wav.toBitDepth("32f");

	const fmt = wav.fmt as { sampleRate: number; numChannels: number };
	const rawSamples = wav.getSamples(false, Float64Array) as unknown;

	const sampleRate = fmt.sampleRate;
	const channels = fmt.numChannels;

	let samples: Array<Float32Array>;

	if (channels === 1) {
		samples = [new Float32Array(rawSamples as Float64Array)];
	} else {
		samples = (rawSamples as Array<Float64Array>).map((channel) => new Float32Array(channel));
	}

	const duration = samples[0]?.length ?? 0;
	const buffer = new ChunkBuffer(duration, channels);

	await buffer.append(samples);

	return { buffer, context: { sampleRate, channels, duration } };
}

export async function runTransform(inputPath: string, transform: TransformModule, options?: { outputBitDepth?: WavBitDepth }): Promise<TransformTestResult> {
	const tempPath = join(tmpdir(), `acm-test-${randomBytes(8).toString("hex")}.wav`);

	try {
		// Read input samples
		const inputResult = await readToBuffer(inputPath);
		const inputChunk = await inputResult.buffer.read(0, inputResult.buffer.frames);
		const inputSamples = inputChunk.samples;
		await inputResult.buffer.close();

		// Build pipeline: read → transform → write
		const source = read(inputPath);
		const target = write(tempPath, { bitDepth: options?.outputBitDepth ?? "32f" });

		source.to(transform);
		transform.to(target);

		await source.render();

		// Read output
		const outputResult = await readToBuffer(tempPath);
		const outputChunk = await outputResult.buffer.read(0, outputResult.buffer.frames);
		const outputSamples = outputChunk.samples;
		await outputResult.buffer.close();

		return {
			input: inputSamples,
			output: outputSamples,
			context: inputResult.context,
		};
	} finally {
		try {
			await unlink(tempPath);
		} catch {
			// Temp file may not exist if pipeline failed before write
		}
	}
}
