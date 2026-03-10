import { z } from "zod";
import { readFile } from "node:fs/promises";
import { WaveFile } from "wavefile";
import type { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	insertPath: z.string().default("").describe("Insert File Path"),
	insertAt: z.number().min(0).default(0).describe("Insert At (frames)"),
});

export interface SpliceProperties extends z.infer<typeof schema>, TransformModuleProperties {}

export class SpliceModule extends TransformModule<SpliceProperties> {
	static override readonly moduleName = "Splice";
	static override readonly schema = schema;
	static override is(value: unknown): value is SpliceModule {
		return TransformModule.is(value) && value.type[2] === "splice";
	}

	override readonly type = ["async-module", "transform", "splice"] as const;
	override readonly bufferSize = 0;
	override readonly latency = 0;

	private insertSamples: Array<Float32Array> = [];
	private insertLength = 0;
	private currentFrame = 0;

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);
		this.currentFrame = 0;

		const data = await readFile(this.properties.insertPath);
		const wav = new WaveFile(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		wav.toBitDepth("32f");

		const fmt = wav.fmt as { sampleRate: number; numChannels: number };
		const rawSamples = wav.getSamples(false, Float64Array) as unknown;

		if (fmt.sampleRate !== context.sampleRate) {
			throw new Error(`Splice: insert file sample rate ${fmt.sampleRate} does not match stream sample rate ${context.sampleRate}`);
		}

		if (fmt.numChannels !== context.channels) {
			throw new Error(`Splice: insert file channels ${fmt.numChannels} does not match stream channels ${context.channels}`);
		}

		if (fmt.numChannels === 1) {
			this.insertSamples = [new Float32Array(rawSamples as Float64Array)];
		} else {
			this.insertSamples = (rawSamples as Array<Float64Array>).map((channel) => new Float32Array(channel));
		}

		this.insertLength = this.insertSamples[0]?.length ?? 0;
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const chunkStart = this.currentFrame;
		const chunkEnd = chunkStart + chunk.duration;
		const insertEnd = this.properties.insertAt + this.insertLength;

		this.currentFrame = chunkEnd;

		if (chunkEnd <= this.properties.insertAt || chunkStart >= insertEnd) {
			return chunk;
		}

		const samples = chunk.samples.map((channel) => new Float32Array(channel));

		const overlapStart = Math.max(0, this.properties.insertAt - chunkStart);
		const overlapEnd = Math.min(chunk.duration, insertEnd - chunkStart);
		const insertOffset = Math.max(0, chunkStart - this.properties.insertAt);

		for (let ch = 0; ch < samples.length; ch++) {
			const channelSamples = samples[ch];
			const insertChannel = this.insertSamples[ch];
			if (!channelSamples || !insertChannel) continue;

			for (let frame = overlapStart; frame < overlapEnd; frame++) {
				const insertIndex = insertOffset + frame - overlapStart;
				const insertSample = insertChannel[insertIndex];
				if (insertSample !== undefined) {
					channelSamples[frame] = insertSample;
				}
			}
		}

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}

	protected override _teardown(): void {
		this.insertSamples = [];
	}

	clone(overrides?: Partial<SpliceProperties>): SpliceModule {
		return new SpliceModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function splice(insertPath: string, insertAt: number): SpliceModule {
	return new SpliceModule({ insertPath, insertAt });
}
