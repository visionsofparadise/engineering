import { readFile } from "node:fs/promises";
import { WaveFile } from "wavefile";
import { z } from "zod";
import type { AudioChunk, StreamContext } from "../module";
import { SourceModule, type SourceModuleProperties } from "../source";

export const schema = z.object({
	path: z.string().default(""),
});

export interface ReadProperties extends z.infer<typeof schema>, SourceModuleProperties {}

const DEFAULT_CHUNK_SIZE = 44100;

export class ReadModule extends SourceModule<ReadProperties> {
	static override readonly moduleName = "Read";
	static override readonly schema = schema;
	override readonly type = ["async-module", "source", "read"] as const;

	readonly bufferSize = 0;
	readonly latency = 0;

	private samples: Array<Float32Array> = [];
	private sampleRate = 0;
	private frameOffset = 0;
	private totalFrames = 0;

	async _init(): Promise<StreamContext> {
		const data = await readFile(this.properties.path);
		const wav = new WaveFile(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		wav.toBitDepth("32f");
		const fmt = wav.fmt as { sampleRate: number; numChannels: number };
		const rawSamples = wav.getSamples(false, Float64Array) as unknown;

		this.sampleRate = fmt.sampleRate;
		const numChannels = fmt.numChannels;

		if (numChannels === 1) {
			this.samples = [new Float32Array(rawSamples as Float64Array)];
		} else {
			this.samples = (rawSamples as Array<Float64Array>).map((channel) => new Float32Array(channel));
		}

		this.totalFrames = this.samples[0]?.length ?? 0;
		this.frameOffset = 0;

		return {
			sampleRate: this.sampleRate,
			channels: numChannels,
			duration: this.totalFrames,
		};
	}

	_read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		if (this.frameOffset >= this.totalFrames) {
			controller.close();
			return Promise.resolve();
		}

		const chunkFrames = Math.min(DEFAULT_CHUNK_SIZE, this.totalFrames - this.frameOffset);
		const chunkSamples = this.samples.map((channel) => channel.slice(this.frameOffset, this.frameOffset + chunkFrames));

		const offset = this.frameOffset;
		this.frameOffset += chunkFrames;

		controller.enqueue({
			samples: chunkSamples,
			offset,
			duration: chunkFrames,
		});

		return Promise.resolve();
	}

	_flush(_controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		return Promise.resolve();
	}

	clone(overrides?: Partial<ReadProperties>): ReadModule {
		return new ReadModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function read(path: string): ReadModule {
	return new ReadModule({ path });
}
