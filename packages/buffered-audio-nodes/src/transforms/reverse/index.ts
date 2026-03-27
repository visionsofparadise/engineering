import { z } from "zod";
import { BufferedTransformStream, FileChunkBuffer, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "buffered-audio-nodes-core";

export const schema = z.object({});

export class ReverseStream extends BufferedTransformStream {
	private spareBuffer?: FileChunkBuffer;
	private spareChunkSize = 44100;
	private spareInitialized = false;
	private reverseMemoryLimit?: number;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		this.reverseMemoryLimit = context.memoryLimit;

		return super._setup(input, context);
	}

	private ensureSpareBuffer(chunk: AudioChunk): void {
		if (this.spareInitialized) return;
		this.spareInitialized = true;
		this.spareChunkSize = chunk.sampleRate;
		this.spareBuffer = new FileChunkBuffer(Infinity, chunk.samples.length, this.reverseMemoryLimit);
	}

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		this.ensureSpareBuffer(chunk);
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
	static override readonly packageName = "buffered-audio-nodes";
	static override readonly moduleDescription = "Reverse audio playback direction";
	static override readonly schema = schema;
	static override is(value: unknown): value is ReverseNode {
		return TransformNode.is(value) && value.type[2] === "reverse";
	}

	override readonly type = ["buffered-audio-node", "transform", "reverse"] as const;

	constructor(properties?: TransformNodeProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): ReverseStream {
		return new ReverseStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<TransformNodeProperties>): ReverseNode {
		return new ReverseNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function reverse(options?: { id?: string }): ReverseNode {
	return new ReverseNode({ id: options?.id });
}
