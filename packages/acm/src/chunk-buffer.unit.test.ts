import { describe, it, expect, afterEach } from "vitest";
import { ChunkBuffer } from "./chunk-buffer";

describe("ChunkBuffer", () => {
	let buffer: ChunkBuffer;

	afterEach(async () => {
		await buffer?.close();
	});

	it("append and read back samples (happy path)", async () => {
		buffer = new ChunkBuffer(1024, 2);

		const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
		const right = new Float32Array([0.5, 0.6, 0.7, 0.8]);
		await buffer.append([left, right]);

		expect(buffer.frames).toBe(4);
		expect(buffer.channels).toBe(2);

		const chunk = await buffer.read(0, 4);
		expect(chunk.duration).toBe(4);
		expect(chunk.offset).toBe(0);
		expect(Array.from(chunk.samples[0]!)).toEqual([
			expect.closeTo(0.1),
			expect.closeTo(0.2),
			expect.closeTo(0.3),
			expect.closeTo(0.4),
		]);
		expect(Array.from(chunk.samples[1]!)).toEqual([
			expect.closeTo(0.5),
			expect.closeTo(0.6),
			expect.closeTo(0.7),
			expect.closeTo(0.8),
		]);
	});

	it("transitions from memory to disk and reads still work", async () => {
		// memoryLimit=256 => storageThreshold = max(1MB, 256*0.04) = 1MB
		// We need storageThreshold to be small. The threshold formula is:
		//   max(1024*1024, min(memoryLimit*0.04, 64*1024*1024))
		// Minimum is 1MB. So we need 1MB / (channels * 4) frames to trigger.
		// With 1 channel: 1MB / 4 = 262144 frames.
		// Use memoryLimit large enough that 0.04 * memoryLimit < 1MB won't help.
		// Actually the min clamp means we can't go below 1MB. Let's just push enough data.
		// 1 channel, memoryLimit=256 => threshold = 1MB. Need > 262144 frames.
		buffer = new ChunkBuffer(1024, 1, 256);

		// Append enough to exceed 1MB (262144 frames * 4 bytes = 1MB, need to exceed)
		const bigChunk = new Float32Array(270000);
		for (let i = 0; i < bigChunk.length; i++) bigChunk[i] = i / bigChunk.length;
		await buffer.append([bigChunk]);

		expect(buffer.frames).toBe(270000);

		// Read back a slice and verify values survived the memory->file transition
		const chunk = await buffer.read(0, 10);
		expect(chunk.duration).toBe(10);
		for (let i = 0; i < 10; i++) {
			expect(chunk.samples[0]![i]).toBeCloseTo(i / bigChunk.length, 5);
		}

		// Read from the middle
		const mid = await buffer.read(135000, 5);
		expect(mid.duration).toBe(5);
		for (let i = 0; i < 5; i++) {
			expect(mid.samples[0]![i]).toBeCloseTo((135000 + i) / bigChunk.length, 5);
		}
	});

	it("append empty array results in frames=0", async () => {
		buffer = new ChunkBuffer(1024, 1);

		await buffer.append([new Float32Array(0)]);
		expect(buffer.frames).toBe(0);

		await buffer.append([]);
		expect(buffer.frames).toBe(0);
	});

	it("read a sub-range returns correct slice", async () => {
		buffer = new ChunkBuffer(1024, 1);

		const data = new Float32Array([10, 20, 30, 40, 50, 60]);
		await buffer.append([data]);

		const chunk = await buffer.read(2, 3);
		expect(chunk.offset).toBe(2);
		expect(chunk.duration).toBe(3);
		expect(Array.from(chunk.samples[0]!)).toEqual([30, 40, 50]);
	});

	it("truncate shortens the buffer", async () => {
		buffer = new ChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3, 4, 5])]);
		expect(buffer.frames).toBe(5);

		await buffer.truncate(3);
		expect(buffer.frames).toBe(3);

		const chunk = await buffer.read(0, 5);
		// Should only get 3 frames back since that's the new length
		expect(chunk.duration).toBe(3);
		expect(Array.from(chunk.samples[0]!)).toEqual([1, 2, 3]);
	});

	it("reset clears state and allows reuse", async () => {
		buffer = new ChunkBuffer(1024, 1);

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
		buffer = new ChunkBuffer(1024, 1);

		await buffer.append([new Float32Array([1, 2, 3])]);
		await buffer.close();

		const chunk = await buffer.read(0, 3);
		expect(chunk.duration).toBe(0);
		expect(chunk.samples).toEqual([]);
	});

	it("expands channels when appending wider data", async () => {
		buffer = new ChunkBuffer(1024, 1);

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
