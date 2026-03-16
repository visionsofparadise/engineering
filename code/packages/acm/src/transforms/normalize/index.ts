import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk } from "../../module";
import { TransformModule, WHOLE_FILE, type TransformModuleProperties } from "../../transform";

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
	override readonly bufferSize = WHOLE_FILE;
	override readonly latency = Infinity;

	private peak = 0;
	private scale = 1;

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		await super._buffer(chunk, buffer);

		for (let ch = 0; ch < chunk.samples.length; ch++) {
			const channel = chunk.samples[ch] ?? new Float32Array(0);
			for (let si = 0; si < channel.length; si++) {
				const absolute = Math.abs(channel[si] ?? 0);
				if (Number.isFinite(absolute) && absolute > this.peak) this.peak = absolute;
			}
		}
	}

	override _process(_buffer: ChunkBuffer): void {
		const raw = this.peak === 0 ? 1 : this.properties.ceiling / this.peak;
		this.scale = Number.isFinite(raw) ? raw : 1;
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
