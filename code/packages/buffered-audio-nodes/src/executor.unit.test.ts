import { describe, expect, it } from "vitest";
import type { ChunkBuffer } from "./buffer";
import { detectCycle } from "./executor";
import { validateGraphDefinition } from "./graph-format";
import type { AudioChunk, StreamContext, StreamMeta } from "./node";
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

function createChunk(value: number, offset: number, duration: number): AudioChunk {
	const samples = new Float32Array(duration).fill(value);
	return { samples: [samples], offset, sampleRate: 44100, bitDepth: 32 };
}

describe("Graph executor", () => {
	it("linear pipeline: source → transform → target", async () => {
		const chunks = [createChunk(1.0, 0, 100)];
		const source = new MockSource(chunks, { sampleRate: 44100, channels: 1 });
		const transform = new MockTransform();
		const target = new MockTarget();

		source.to(transform).to(target);
		await source.render();

		expect(transform.processedChunks).toHaveLength(1);
		expect(target.lastCreatedStream?.receivedChunks).toHaveLength(1);
		expect(target.lastCreatedStream?.closed).toBe(true);
	});

	it("fan-out: source → two targets", async () => {
		const chunks = [createChunk(1.0, 0, 100)];
		const source = new MockSource(chunks, { sampleRate: 44100, channels: 1 });
		const target1 = new MockTarget();
		const target2 = new MockTarget();

		source.to(target1);
		source.to(target2);
		await source.render();

		expect(target1.lastCreatedStream?.receivedChunks).toHaveLength(1);
		expect(target2.lastCreatedStream?.receivedChunks).toHaveLength(1);
		expect(target1.lastCreatedStream?.closed).toBe(true);
		expect(target2.lastCreatedStream?.closed).toBe(true);
	});

	it("fan-out through transform: source → transform → two targets", async () => {
		const chunks = [createChunk(0.5, 0, 100)];
		const source = new MockSource(chunks, { sampleRate: 44100, channels: 1 });
		const transform = new MockTransform();
		const target1 = new MockTarget();
		const target2 = new MockTarget();

		const t = source.to(transform);
		t.to(target1);
		t.to(target2);
		await source.render();

		expect(transform.processedChunks).toHaveLength(1);
		expect(target1.lastCreatedStream?.receivedChunks).toHaveLength(1);
		expect(target2.lastCreatedStream?.receivedChunks).toHaveLength(1);
	});

	it("cycle detection throws", () => {
		const source = new MockSource();
		const transform = new MockTransform();

		source.to(transform);
		transform.children.push(source);

		expect(() => detectCycle(source)).toThrow("Cycle detected");
	});

	it("validates graph definition schema", () => {
		const valid = validateGraphDefinition({
			name: "Test",
			nodes: [
				{ id: "a", package: "buffered-audio-nodes", node: "read" },
				{ id: "b", package: "buffered-audio-nodes", node: "write" },
			],
			edges: [{ from: "a", to: "b" }],
		});

		expect(valid.name).toBe("Test");
		expect(valid.nodes).toHaveLength(2);
		expect(valid.edges).toHaveLength(1);
	});

	it("validates graph definition with default name", () => {
		const valid = validateGraphDefinition({
			nodes: [{ id: "a", package: "buffered-audio-nodes", node: "read" }],
			edges: [],
		});

		expect(valid.name).toBe("Untitled");
	});

	it("rejects invalid graph definition", () => {
		expect(() =>
			validateGraphDefinition({
				nodes: [{ id: "", package: "test", node: "read" }],
				edges: [],
			}),
		).toThrow();
	});
});
