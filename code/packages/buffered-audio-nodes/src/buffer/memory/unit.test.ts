import { afterEach, describe, expect, it } from "vitest";
import { MemoryChunkBuffer } from ".";

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
