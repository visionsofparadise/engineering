import { afterEach, describe, expect, it } from "vitest";
import { FileChunkBuffer, MemoryChunkBuffer } from ".";

describe("MemoryChunkBuffer", () => {
	let buffer: MemoryChunkBuffer;

	afterEach(async () => {
		await buffer?.close();
	});

	it("append and read back samples (happy path)", async () => {
		buffer = new MemoryChunkBuffer(1024, 2);

		const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
		const right = new Float32Array([0.5, 0.6, 0.7, 0.8]);
		await buffer.append([left, right]);

		expect(buffer.frames).toBe(4);
		expect(buffer.channels).toBe(2);

		const chunk = await buffer.read(0, 4);
		expect(chunk.samples[0]?.length ?? 0).toBe(4);
		expect(chunk.offset).toBe(0);
		expect(Array.from(chunk.samples[0]!)).toEqual([expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.4)]);
		expect(Array.from(chunk.samples[1]!)).toEqual([expect.closeTo(0.5), expect.closeTo(0.6), expect.closeTo(0.7), expect.closeTo(0.8)]);
	});

	it("append empty array results in frames=0", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array(0)]);
		expect(buffer.frames).toBe(0);

		await buffer.append([]);
		expect(buffer.frames).toBe(0);
	});

	it("read a sub-range returns correct slice", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		const data = new Float32Array([10, 20, 30, 40, 50, 60]);
		await buffer.append([data]);

		const chunk = await buffer.read(2, 3);
		expect(chunk.offset).toBe(2);
		expect(chunk.samples[0]?.length ?? 0).toBe(3);
		expect(Array.from(chunk.samples[0]!)).toEqual([30, 40, 50]);
	});

	it("truncate shortens the buffer", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3, 4, 5])]);
		expect(buffer.frames).toBe(5);

		await buffer.truncate(3);
		expect(buffer.frames).toBe(3);

		const chunk = await buffer.read(0, 5);
		// Should only get 3 frames back since that's the new length
		expect(chunk.samples[0]?.length ?? 0).toBe(3);
		expect(Array.from(chunk.samples[0]!)).toEqual([1, 2, 3]);
	});

	it("reset clears state and allows reuse", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3])]);
		expect(buffer.frames).toBe(3);

		await buffer.reset();
		expect(buffer.frames).toBe(0);

		await buffer.append([new Float32Array([7, 8])]);
		expect(buffer.frames).toBe(2);

		const chunk = await buffer.read(0, 2);
		expect(Array.from(chunk.samples[0]!)).toEqual([7, 8]);
	});

	it("read after close returns empty", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3])]);
		await buffer.close();

		const chunk = await buffer.read(0, 3);
		expect(chunk.samples[0]?.length ?? 0).toBe(0);
		expect(chunk.samples).toEqual([]);
	});

	it("captures sampleRate and bitDepth from first append", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2])], 44100, 16);

		expect(buffer.sampleRate).toBe(44100);
		expect(buffer.bitDepth).toBe(16);

		const chunk = await buffer.read(0, 2);
		expect(chunk.sampleRate).toBe(44100);
		expect(chunk.bitDepth).toBe(16);
	});

	it("allows subsequent appends with matching metadata", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])], 48000, 24);
		await buffer.append([new Float32Array([2])], 48000, 24);

		expect(buffer.frames).toBe(2);
		expect(buffer.sampleRate).toBe(48000);
		expect(buffer.bitDepth).toBe(24);
	});

	it("throws on sample rate mismatch", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])], 44100, 16);
		await expect(buffer.append([new Float32Array([2])], 48000, 16)).rejects.toThrow("sample rate mismatch");
	});

	it("throws on bit depth mismatch", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])], 44100, 16);
		await expect(buffer.append([new Float32Array([2])], 44100, 24)).rejects.toThrow("bit depth mismatch");
	});

	it("setSampleRate overrides captured value", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])], 44100, 16);
		buffer.setSampleRate(48000);

		expect(buffer.sampleRate).toBe(48000);

		const chunk = await buffer.read(0, 1);
		expect(chunk.sampleRate).toBe(48000);
	});

	it("setBitDepth overrides captured value", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])], 44100, 32);
		buffer.setBitDepth(16);

		expect(buffer.bitDepth).toBe(16);

		const chunk = await buffer.read(0, 1);
		expect(chunk.bitDepth).toBe(16);
	});

	it("iterate returns AudioChunks with metadata", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3, 4])], 96000, 24);

		const chunks = [];
		for await (const chunk of buffer.iterate(2)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(2);
		for (const chunk of chunks) {
			expect(chunk.sampleRate).toBe(96000);
			expect(chunk.bitDepth).toBe(24);
		}
	});

	it("metadata is undefined when appended without it", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])]);

		expect(buffer.sampleRate).toBeUndefined();
		expect(buffer.bitDepth).toBeUndefined();
	});

	it("expands channels when appending wider data", async () => {
		buffer = new MemoryChunkBuffer(1024, 1);

		// Start with mono
		await buffer.append([new Float32Array([1, 2])]);
		expect(buffer.channels).toBe(1);

		// Append stereo — should expand to 2 channels
		await buffer.append([new Float32Array([3, 4]), new Float32Array([5, 6])]);
		expect(buffer.channels).toBe(2);
		expect(buffer.frames).toBe(4);

		// Read all back: channel 0 has [1,2,3,4], channel 1 has [0,0,5,6]
		const chunk = await buffer.read(0, 4);
		expect(Array.from(chunk.samples[0]!)).toEqual([1, 2, 3, 4]);
		expect(chunk.samples[1]![0]).toBe(0); // padded with 0 before expansion
		expect(chunk.samples[1]![1]).toBe(0);
		expect(chunk.samples[1]![2]).toBeCloseTo(5);
		expect(chunk.samples[1]![3]).toBeCloseTo(6);
	});
});

describe("FileChunkBuffer", () => {
	let buffer: FileChunkBuffer;

	afterEach(async () => {
		await buffer?.close();
	});

	it("append and read back samples", async () => {
		buffer = new FileChunkBuffer(1024, 2);

		const left = new Float32Array([0.1, 0.2, 0.3]);
		const right = new Float32Array([0.4, 0.5, 0.6]);
		await buffer.append([left, right]);

		expect(buffer.frames).toBe(3);
		expect(buffer.channels).toBe(2);

		const chunk = await buffer.read(0, 3);
		expect(chunk.samples).toHaveLength(2);
		expect(chunk.samples[0]![0]).toBeCloseTo(0.1);
		expect(chunk.samples[0]![1]).toBeCloseTo(0.2);
		expect(chunk.samples[0]![2]).toBeCloseTo(0.3);
		expect(chunk.samples[1]![0]).toBeCloseTo(0.4);
		expect(chunk.samples[1]![1]).toBeCloseTo(0.5);
		expect(chunk.samples[1]![2]).toBeCloseTo(0.6);
	});

	it("read sub-range", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([10, 20, 30, 40, 50])]);

		const chunk = await buffer.read(1, 3);
		expect(chunk.offset).toBe(1);
		expect(Array.from(chunk.samples[0]!)).toEqual([20, 30, 40]);
	});

	it("write overwrites data at offset", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3, 4, 5])]);
		await buffer.write(2, [new Float32Array([30, 40])]);

		const chunk = await buffer.read(0, 5);
		expect(Array.from(chunk.samples[0]!)).toEqual([1, 2, 30, 40, 5]);
	});

	it("truncate shortens the buffer", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3, 4, 5])]);
		await buffer.truncate(3);
		expect(buffer.frames).toBe(3);

		const chunk = await buffer.read(0, 5);
		expect(chunk.samples[0]!.length).toBe(3);
	});

	it("reset clears the buffer", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3])]);
		await buffer.reset();
		expect(buffer.frames).toBe(0);
	});

	it("iterate yields chunks", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3, 4, 5])]);

		const chunks = [];
		for await (const chunk of buffer.iterate(2)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(3); // 2+2+1
		expect(chunks[0]!.samples[0]!.length).toBe(2);
		expect(chunks[2]!.samples[0]!.length).toBe(1);
	});

	it("captures and returns metadata", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1])], 96000, 24);
		expect(buffer.sampleRate).toBe(96000);
		expect(buffer.bitDepth).toBe(24);

		const chunk = await buffer.read(0, 1);
		expect(chunk.sampleRate).toBe(96000);
		expect(chunk.bitDepth).toBe(24);
	});

	it("close cleans up and returns empty on read", async () => {
		buffer = new FileChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3])]);
		await buffer.close();

		const chunk = await buffer.read(0, 3);
		expect(chunk.samples).toEqual([]);
	});

	it("transitions from memory to disk and reads still work", async () => {
		// memoryLimit=256 => storageThreshold = max(1MB, 256*0.04) = 1MB
		// With 1 channel: 1MB / 4 = 262144 frames. Need > 262144 to trigger.
		buffer = new FileChunkBuffer(1024, 1, 256);

		const bigChunk = new Float32Array(270000);
		for (let i = 0; i < bigChunk.length; i++) bigChunk[i] = i / bigChunk.length;
		await buffer.append([bigChunk]);

		expect(buffer.frames).toBe(270000);

		// Read back a slice and verify values survived the memory->file transition
		const chunk = await buffer.read(0, 10);
		expect(chunk.samples[0]?.length ?? 0).toBe(10);
		for (let i = 0; i < 10; i++) {
			expect(chunk.samples[0]![i]).toBeCloseTo(i / bigChunk.length, 5);
		}

		// Read from the middle
		const mid = await buffer.read(135000, 5);
		expect(mid.samples[0]?.length ?? 0).toBe(5);
		for (let i = 0; i < 5; i++) {
			expect(mid.samples[0]![i]).toBeCloseTo((135000 + i) / bigChunk.length, 5);
		}
	});

	it("preserves metadata after memory-to-file flush", async () => {
		buffer = new FileChunkBuffer(1024, 1, 256);

		await buffer.append([new Float32Array(100)], 44100, 16);

		// Force flush with a large append
		const bigChunk = new Float32Array(270000);
		await buffer.append([bigChunk], 44100, 16);

		expect(buffer.sampleRate).toBe(44100);
		expect(buffer.bitDepth).toBe(16);

		const chunk = await buffer.read(0, 1);
		expect(chunk.sampleRate).toBe(44100);
		expect(chunk.bitDepth).toBe(16);
	});

	it("setSampleRate works after memory-to-file flush", async () => {
		buffer = new FileChunkBuffer(1024, 1, 256);

		const bigChunk = new Float32Array(270000);
		await buffer.append([bigChunk], 44100, 16);

		// After flush, setSampleRate should still work
		buffer.setSampleRate(48000);
		expect(buffer.sampleRate).toBe(48000);

		const chunk = await buffer.read(0, 1);
		expect(chunk.sampleRate).toBe(48000);
	});

	it("write works after memory-to-file flush", async () => {
		buffer = new FileChunkBuffer(1024, 1, 256);

		const bigChunk = new Float32Array(270000);
		for (let i = 0; i < bigChunk.length; i++) bigChunk[i] = 0;
		await buffer.append([bigChunk]);

		// After flush, write should use file I/O
		const patch = new Float32Array([0.5, 0.6, 0.7]);
		await buffer.write(100, [patch]);

		const chunk = await buffer.read(100, 3);
		expect(chunk.samples[0]![0]).toBeCloseTo(0.5);
		expect(chunk.samples[0]![1]).toBeCloseTo(0.6);
		expect(chunk.samples[0]![2]).toBeCloseTo(0.7);
	});

	it("truncate works after memory-to-file flush", async () => {
		buffer = new FileChunkBuffer(1024, 1, 256);

		const bigChunk = new Float32Array(270000);
		await buffer.append([bigChunk]);

		expect(buffer.frames).toBe(270000);

		await buffer.truncate(1000);
		expect(buffer.frames).toBe(1000);
	});

	it("reset works after memory-to-file flush", async () => {
		buffer = new FileChunkBuffer(1024, 1, 256);

		const bigChunk = new Float32Array(270000);
		await buffer.append([bigChunk]);

		await buffer.reset();
		expect(buffer.frames).toBe(0);
	});

	it("iterate works after memory-to-file flush", async () => {
		buffer = new FileChunkBuffer(1024, 1, 256);

		const bigChunk = new Float32Array(270000);
		for (let i = 0; i < bigChunk.length; i++) bigChunk[i] = i / bigChunk.length;
		await buffer.append([bigChunk]);

		const chunks = [];
		for await (const chunk of buffer.iterate(100000)) {
			chunks.push(chunk);
		}

		expect(chunks).toHaveLength(3); // 270000 / 100000 = 2.7 => 3 chunks
		expect(chunks[0]!.samples[0]!.length).toBe(100000);
		expect(chunks[1]!.samples[0]!.length).toBe(100000);
		expect(chunks[2]!.samples[0]!.length).toBe(70000);
	});
});
