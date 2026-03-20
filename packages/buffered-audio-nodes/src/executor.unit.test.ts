import { describe, expect, it } from "vitest";
import type { ChunkBuffer } from "./buffer";
import { validateGraphDefinition } from "./graph-format";
import type { AudioChunk } from "./node";
import type { SourceMetadata } from "./sources";
import { BufferedSourceStream, SourceNode } from "./sources";
import { BufferedTargetStream, TargetNode } from "./targets";
import { BufferedTransformStream, TransformNode } from "./transforms";

class MockSourceStream extends BufferedSourceStream {
	override async getMetadata(): Promise<SourceMetadata> {
		return this.properties.meta as SourceMetadata;
	}

	override async _read(): Promise<AudioChunk | undefined> {
		const chunks = this.properties.chunks as Array<AudioChunk>;
		const index = this.properties.chunkIndex as number;
		const chunk = chunks[index];
		if (chunk) {
			(this.properties as Record<string, unknown>).chunkIndex = index + 1;
			return chunk;
		}
		return undefined;
	}

	override async _flush(): Promise<void> {}
}

class MockSource extends SourceNode {
	readonly type = ["buffered-audio-node", "source", "mock"] as const;
	get bufferSize(): number { return 0; }
	get latency(): number { return 0; }

	constructor(chunks: Array<AudioChunk> = [], meta: SourceMetadata = { sampleRate: 44100, channels: 1 }) {
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
	readonly type = ["buffered-audio-node", "transform", "mock"] as const;
	get bufferSize(): number { return 0; }
	get latency(): number { return 0; }

	private _lastStream?: MockTransformStream;

	get processedChunks(): Array<AudioChunk> {
		return this._lastStream?.processedChunks ?? [];
	}

	override createStream(): MockTransformStream {
		this._lastStream = new MockTransformStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
		return this._lastStream;
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
	readonly type = ["buffered-audio-node", "target", "mock"] as const;
	get bufferSize(): number { return 0; }
	get latency(): number { return 0; }

	private _lastStream?: MockTargetStream;

	get lastCreatedStream(): MockTargetStream | undefined {
		return this._lastStream;
	}

	override createStream(): MockTargetStream {
		this._lastStream = new MockTargetStream(this.properties as unknown as Record<string, unknown>);
		return this._lastStream;
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

	it("cycle detection throws", async () => {
		const source = new MockSource([], { sampleRate: 44100, channels: 1 });
		const transform = new MockTransform();
		const target = new MockTarget();

		source.to(transform);
		transform.to(target);
		transform.to(target);

		await expect(source.render()).rejects.toThrow("Cycle detected");
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
