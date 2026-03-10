import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	ceiling: z.number().min(0).max(1).multipleOf(0.01).default(1.0).describe("Ceiling"),
});

export interface NormalizeProperties extends z.infer<typeof schema>, TransformModuleProperties {}

export class NormalizeModule extends TransformModule<NormalizeProperties> {
	static override readonly moduleName = "Normalize";
	static override readonly moduleDescription = "Adjust peak or loudness level to a target ceiling";
	static override readonly schema = schema;
	static override is(value: unknown): value is NormalizeModule {
		return TransformModule.is(value) && value.type[2] === "normalize";
	}

	override readonly type = ["async-module", "transform", "normalize"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private peak = 0;
	private scale = 1;

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		await super._buffer(chunk, buffer);

		for (const channel of chunk.samples) {
			for (const sample of channel) {
				const absolute = Math.abs(sample);

				if (absolute > this.peak) this.peak = absolute;
			}
		}
	}

	override _process(_buffer: ChunkBuffer): void {
		this.scale = this.peak === 0 ? 1 : this.properties.ceiling / this.peak;
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		if (this.scale === 1) return chunk;

		const scaledSamples = chunk.samples.map((channel) => {
			const scaled = new Float32Array(channel.length);

			for (let index = 0; index < channel.length; index++) {
				scaled[index] = (channel[index] ?? 0) * this.scale;
			}

			return scaled;
		});

		return { samples: scaledSamples, offset: chunk.offset, duration: chunk.duration };
	}

	clone(overrides?: Partial<NormalizeProperties>): NormalizeModule {
		return new NormalizeModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function normalize(options?: { ceiling?: number; id?: string }): NormalizeModule {
	return new NormalizeModule({ ceiling: options?.ceiling ?? 1.0, id: options?.id });
}
