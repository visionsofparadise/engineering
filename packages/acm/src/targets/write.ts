import { writeFile } from "node:fs/promises";
import { WaveFile } from "wavefile";
import type { AudioChainModuleInput, AudioChunk, StreamContext } from "../module";
import { TargetModule, type TargetModuleProperties } from "../target";

export type WavBitDepth = "16" | "24" | "32" | "32f";

export interface WriteProperties extends TargetModuleProperties {
	readonly path: string;
	readonly bitDepth: WavBitDepth;
}

export class WriteModule extends TargetModule {
	readonly type = ["async-module", "target", "write"] as const;

	readonly properties: WriteProperties;
	readonly bufferSize = 0;
	readonly latency = 0;

	private channelBuffers: Array<Array<Float32Array>> = [];
	private context?: StreamContext;

	constructor(properties: AudioChainModuleInput<WriteProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	override _setup(context: StreamContext): void {
		this.context = context;
		this.channelBuffers = [];

		for (let channel = 0; channel < context.channels; channel++) {
			this.channelBuffers.push([]);
		}
	}

	_write(chunk: AudioChunk): Promise<void> {
		for (let channel = 0; channel < chunk.samples.length; channel++) {
			const channelSamples = chunk.samples[channel];
			const channelBuffer = this.channelBuffers[channel];

			if (channelSamples && channelBuffer) {
				channelBuffer.push(channelSamples);
			}
		}

		return Promise.resolve();
	}

	async _close(): Promise<void> {
		if (!this.context) return;

		const channels = this.channelBuffers.map((chunks) => {
			const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
			const merged = new Float32Array(totalLength);
			let offset = 0;

			for (const chunk of chunks) {
				merged.set(chunk, offset);
				offset += chunk.length;
			}

			return merged;
		});

		const wav = new WaveFile();
		wav.fromScratch(this.context.channels, this.context.sampleRate, "32f", channels);

		if (this.properties.bitDepth !== "32f") {
			wav.toBitDepth(this.properties.bitDepth);
		}

		const bytes = wav.toBuffer();
		await writeFile(this.properties.path, bytes);

		this.channelBuffers = [];
	}

	clone(overrides?: Partial<WriteProperties>): WriteModule {
		return new WriteModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function write(path: string, options?: { bitDepth?: WavBitDepth }): WriteModule {
	return new WriteModule({
		path,
		bitDepth: options?.bitDepth ?? "16",
	});
}
