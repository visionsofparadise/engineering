import { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export class ReverseModule extends TransformModule {
	static override readonly moduleName = "Reverse";
	static override readonly moduleDescription = "Reverse audio playback direction";
	static override is(value: unknown): value is ReverseModule {
		return TransformModule.is(value) && value.type[2] === "reverse";
	}

	override readonly type = ["async-module", "transform", "reverse"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private spareBuffer?: ChunkBuffer;
	private spareChunkSize = 44100;

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.spareChunkSize = context.sampleRate;
		this.spareBuffer = new ChunkBuffer(Infinity, context.channels, this.properties.storageThreshold);
	}

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		await super._buffer(chunk, buffer);
		await this.spareBuffer?.append(chunk.samples);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.spareBuffer) return;

		await buffer.truncate(0);

		let remaining = this.spareBuffer.frames;

		while (remaining > 0) {
			const frames = Math.min(this.spareChunkSize, remaining);
			const offset = remaining - frames;
			const chunk = await this.spareBuffer.read(offset, frames);

			for (const channel of chunk.samples) {
				channel.reverse();
			}

			await buffer.append(chunk.samples);
			remaining = offset;
		}

		await this.spareBuffer.close();
		this.spareBuffer = undefined;
	}

	clone(overrides?: Partial<TransformModuleProperties>): ReverseModule {
		return new ReverseModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function reverse(options?: { id?: string }): ReverseModule {
	return new ReverseModule({ id: options?.id });
}
