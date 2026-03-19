import { describe, it, expect, vi } from "vitest";
import { BufferedAudioNode } from "./node";
import { BufferedSourceStream, SourceNode } from "./source";
import { BufferedTransformStream, TransformNode } from "./transform";
import { BufferedTargetStream, TargetNode } from "./target";
import type { AudioChunk, StreamContext, StreamMeta } from "./node";
import type { ChunkBuffer } from "./chunk-buffer";

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

	private lastCreatedTransformStream?: MockTransformStream;

	get processedChunks(): Array<AudioChunk> {
		return this.lastCreatedTransformStream?.processedChunks ?? [];
	}

	protected override createStream(context: StreamContext): MockTransformStream {
		const stream = new MockTransformStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
		this.lastCreatedTransformStream = stream;
		return stream;
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

	lastCreatedStream?: MockTargetStream;

	protected override createStream(context: StreamContext): MockTargetStream {
		return new MockTargetStream(this.properties as unknown as Record<string, unknown>, context);
	}

	override createWritable(): WritableStream<AudioChunk> {
		if (!this.streamContext) throw new Error("Stream context not initialized");
		const stream = new MockTargetStream(this.properties as unknown as Record<string, unknown>, this.streamContext);
		this.lastCreatedStream = stream;
		return stream.createWritableStream();
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
	protected override createStream(context: StreamContext): FailingTargetStream {
		return new FailingTargetStream(this.properties as unknown as Record<string, unknown>, context);
	}
	clone(): FailingTarget { return new FailingTarget(); }
}

function createChunk(value: number, offset: number, duration: number): AudioChunk {
	const samples = new Float32Array(duration).fill(value);
	return { samples: [samples], offset, duration };
}

const testMeta: StreamMeta = { sampleRate: 44100, channels: 1 };
const testContext: StreamContext = { ...testMeta, executionProviders: ["gpu", "cpu-native", "cpu"], memoryLimit: 256 * 1024 * 1024 };

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

	it("setup() recurses to targets", async () => {
		const source = new MockSource();
		const transform = new MockTransform();
		const target = new MockTarget();

		const sourceSetup = vi.spyOn(source, "_setup" as keyof MockSource);
		const transformSetup = vi.spyOn(transform, "_setup" as keyof MockTransform);
		const targetSetup = vi.spyOn(target, "_setup" as keyof MockTarget);

		source.to(transform);
		transform.to(target);

		await source.setup(testContext);

		expect(sourceSetup).toHaveBeenCalledWith(testContext);
		expect(transformSetup).toHaveBeenCalledWith(testContext);
		expect(targetSetup).toHaveBeenCalledWith(testContext);
	});

	it("teardown() recurses to targets", async () => {
		const source = new MockSource();
		const transform = new MockTransform();
		const target = new MockTarget();

		const sourceTeardown = vi.spyOn(source, "_teardown" as keyof MockSource);
		const transformTeardown = vi.spyOn(transform, "_teardown" as keyof MockTransform);
		const targetTeardown = vi.spyOn(target, "_teardown" as keyof MockTarget);

		source.to(transform);
		transform.to(target);

		await source.teardown();

		expect(sourceTeardown).toHaveBeenCalled();
		expect(transformTeardown).toHaveBeenCalled();
		expect(targetTeardown).toHaveBeenCalled();
	});

	it("abstract bufferSize and latency must be implemented", () => {
		const source = new MockSource();
		expect(source.bufferSize).toBe(0);
		expect(source.latency).toBe(0);
	});
});

describe("SourceNode render", () => {
	it("source → target pipeline flows chunks", async () => {
		const chunks = [
			createChunk(1.0, 0, 100),
			createChunk(0.5, 100, 100),
		];
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
		const teardownSpy = vi.spyOn(source, "_teardown" as keyof MockSource);

		source.to(target);

		await expect(source.render()).rejects.toThrow("write failed");
		expect(teardownSpy).toHaveBeenCalled();
	});
});
