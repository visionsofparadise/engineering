import { describe, expect, it } from "vitest";
import type { ChunkBuffer } from "./buffer";
import type { AudioChunk, StreamContext, StreamMeta } from "./node";
import { BufferedAudioNode } from "./node";
import { BufferedSourceStream, SourceNode } from "./sources";
import { BufferedTargetStream, TargetNode } from "./targets";
import { BufferedTransformStream, TransformNode } from "./transforms";

class MockSourceStream extends BufferedSourceStream {
	override async _init(): Promise<StreamMeta> {
		return this.properties.meta as StreamMeta;
	}

	override async _read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		const chunks = this.properties.chunks as Array<AudioChunk>;
		const index = this.properties.chunkIndex as number;
		const chunk = chunks[index];
		if (chunk) {
			(this.properties as Record<string, unknown>).chunkIndex = index + 1;
			controller.enqueue(chunk);
		} else {
			controller.close();
		}
	}

	override async _flush(): Promise<void> {}
}

class MockSource extends SourceNode {
	readonly type = ["async-module", "source", "mock"] as const;
	readonly bufferSize = 0;
	readonly latency = 0;

	constructor(chunks: Array<AudioChunk> = [], meta: StreamMeta = { sampleRate: 44100, channels: 1 }) {
		super({ chunks, meta, chunkIndex: 0 } as never);
	}

	protected override createStream(): MockSourceStream {
		return new MockSourceStream(this.properties);
	}

	clone(): MockSource {
		return new MockSource();
	}
}

class MockTransformStream extends BufferedTransformStream {
	readonly processedChunks: Array<AudioChunk> = [];

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		await super._buffer(chunk, buffer);
		this.processedChunks.push(chunk);
	}
}

class MockTransform extends TransformNode {
	readonly type = ["async-module", "transform", "mock"] as const;
	readonly bufferSize = 0;
	readonly latency = 0;

	get processedChunks(): Array<AudioChunk> {
		const last = this.streams[this.streams.length - 1];
		return last instanceof MockTransformStream ? last.processedChunks : [];
	}

	override createStream(context: StreamContext): MockTransformStream {
		return new MockTransformStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	clone(): MockTransform {
		return new MockTransform();
	}
}

class MockTargetStream extends BufferedTargetStream {
	readonly receivedChunks: Array<AudioChunk> = [];
	closed = false;

	override async _write(chunk: AudioChunk): Promise<void> {
		this.receivedChunks.push(chunk);
	}

	override async _close(): Promise<void> {
		this.closed = true;
	}
}

class MockTarget extends TargetNode {
	readonly type = ["async-module", "target", "mock"] as const;
	readonly bufferSize = 0;
	readonly latency = 0;

	get lastCreatedStream(): MockTargetStream | undefined {
		const last = this.streams[this.streams.length - 1];
		return last instanceof MockTargetStream ? last : undefined;
	}

	override createStream(context: StreamContext): MockTargetStream {
		return new MockTargetStream(this.properties as unknown as Record<string, unknown>, context);
	}

	clone(): MockTarget {
		return new MockTarget();
	}
}

class FailingTargetStream extends BufferedTargetStream {
	override async _write(): Promise<void> {
		throw new Error("write failed");
	}

	override async _close(): Promise<void> {}
}

class FailingTarget extends TargetNode {
	readonly type = ["async-module", "target", "failing"] as const;
	readonly bufferSize = 0;
	readonly latency = 0;
	override createStream(context: StreamContext): FailingTargetStream {
		return new FailingTargetStream(this.properties as unknown as Record<string, unknown>, context);
	}
	clone(): FailingTarget {
		return new FailingTarget();
	}
}

function createChunk(value: number, offset: number, duration: number): AudioChunk {
	const samples = new Float32Array(duration).fill(value);
	return { samples: [samples], offset, sampleRate: 44100, bitDepth: 32 };
}

const testMeta: StreamMeta = { sampleRate: 44100, channels: 1 };

describe("BufferedAudioNode", () => {
	it("type discrimination with is()", () => {
		const source = new MockSource();
		const transform = new MockTransform();
		const target = new MockTarget();

		expect(BufferedAudioNode.is(source)).toBe(true);
		expect(BufferedAudioNode.is(transform)).toBe(true);
		expect(BufferedAudioNode.is(target)).toBe(true);
		expect(BufferedAudioNode.is({})).toBe(false);
		expect(BufferedAudioNode.is(null)).toBe(false);

		expect(SourceNode.is(source)).toBe(true);
		expect(SourceNode.is(transform)).toBe(false);

		expect(TransformNode.is(transform)).toBe(true);
		expect(TransformNode.is(source)).toBe(false);

		expect(TargetNode.is(target)).toBe(true);
		expect(TargetNode.is(source)).toBe(false);
	});

	it("to() appends child and returns target", () => {
		const source = new MockSource();
		const target = new MockTarget();

		const result = source.to(target);
		expect(source.children).toContain(target);
		expect(result).toBe(target);
	});

	it("teardown() iterates streams and recurses to children", async () => {
		const source = new MockSource();
		const transform = new MockTransform();
		const target = new MockTarget();

		source.to(transform);
		transform.to(target);

		let tornDown = false;
		source.streams.push({
			_teardown() {
				tornDown = true;
			},
		});

		await source.teardown();

		expect(tornDown).toBe(true);
	});

	it("clearStreams() empties streams on node and children", () => {
		const source = new MockSource();
		const transform = new MockTransform();
		const target = new MockTarget();

		source.to(transform);
		transform.to(target);

		source.streams.push({ _teardown() {} });
		transform.streams.push({ _teardown() {} });

		source.clearStreams();

		expect(source.streams).toHaveLength(0);
		expect(transform.streams).toHaveLength(0);
	});

	it("abstract bufferSize and latency must be implemented", () => {
		const source = new MockSource();
		expect(source.bufferSize).toBe(0);
		expect(source.latency).toBe(0);
	});
});

describe("SourceNode render", () => {
	it("source → target pipeline flows chunks", async () => {
		const chunks = [createChunk(1.0, 0, 100), createChunk(0.5, 100, 100)];
		const source = new MockSource(chunks, testMeta);
		const target = new MockTarget();

		source.to(target);
		await source.render();

		expect(target.lastCreatedStream?.receivedChunks).toHaveLength(2);
		expect(target.lastCreatedStream?.receivedChunks[0]?.samples[0]?.[0]).toBe(1.0);
		expect(target.lastCreatedStream?.receivedChunks[1]?.samples[0]?.[0]).toBe(0.5);
		expect(target.lastCreatedStream?.closed).toBe(true);
	});

	it("source → transform → target pipeline flows chunks", async () => {
		const chunks = [createChunk(1.0, 0, 100)];
		const source = new MockSource(chunks, testMeta);
		const transform = new MockTransform();
		const target = new MockTarget();

		source.to(transform);
		transform.to(target);
		await source.render();

		expect(transform.processedChunks).toHaveLength(1);
		expect(target.lastCreatedStream?.receivedChunks).toHaveLength(1);
		expect(target.lastCreatedStream?.closed).toBe(true);
	});

	it("teardown runs on error", async () => {
		const source = new MockSource([createChunk(1.0, 0, 100)], testMeta);
		const target = new FailingTarget();

		source.to(target);

		await expect(source.render()).rejects.toThrow("write failed");
	});
});
