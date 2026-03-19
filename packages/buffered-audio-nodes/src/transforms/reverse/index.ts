import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk, StreamContext } from "../../node";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "../../transform";

export const schema = z.object({});

export class ReverseStream extends BufferedTransformStream<TransformNodeProperties> {
	private spareBuffer?: ChunkBuffer;
	private spareChunkSize: number;

	constructor(properties: TransformNodeProperties, context: StreamContext) {
		super(properties, context);
		this.spareChunkSize = context.sampleRate;
		this.spareBuffer = new ChunkBuffer(Infinity, context.channels, context.memoryLimit);
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
}

export class ReverseNode extends TransformNode {
	static override readonly moduleName = "Reverse";
	static override readonly moduleDescription = "Reverse audio playback direction";
	static override readonly schema = schema;
	static override is(value: unknown): value is ReverseNode {
		return TransformNode.is(value) && value.type[2] === "reverse";
	}

	override readonly type = ["async-module", "transform", "reverse"] as const;
	override readonly bufferSize = WHOLE_FILE;
	override readonly latency = WHOLE_FILE;

	protected override createStream(context: StreamContext): ReverseStream {
		return new ReverseStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<TransformNodeProperties>): ReverseNode {
		return new ReverseNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function reverse(options?: { id?: string }): ReverseNode {
	return new ReverseNode({ id: options?.id });
}
