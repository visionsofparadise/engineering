import { readFile } from "node:fs/promises";
import { WaveFile } from "wavefile";
import { ChunkBuffer } from "../chunk-buffer";
import type { StreamMeta } from "../module";

export interface ReadToBufferResult {
	readonly buffer: ChunkBuffer;
	readonly context: StreamMeta;
}

export async function readToBuffer(path: string): Promise<ReadToBufferResult> {
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

	return {
		buffer,
		context: { sampleRate, channels, duration },
	};
}
