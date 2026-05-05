import { MemoryChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { describe, expect, it } from "vitest";
import { computeLinkedDetection } from "./detect";

const SAMPLE_RATE = 48_000;

/**
 * Wrap per-channel arrays in a `MemoryChunkBuffer`. Mirrors the
 * loudness-shaper iterate test pattern. Returns a fresh buffer so the
 * `iterate` cursor walks from 0 each call.
 *
 * `appendChunkFrames` controls the chunk granularity used at append
 * time (the buffer's internal segmentation), letting tests assert that
 * the detection result is independent of how the buffer was filled.
 */
async function makeBufferFromChannels(
	channels: ReadonlyArray<Float32Array>,
	appendChunkFrames = 32,
): Promise<MemoryChunkBuffer> {
	const buffer = new MemoryChunkBuffer(Infinity, channels.length);

	await buffer.append(
		channels.map((channel) => new Float32Array(channel)),
		SAMPLE_RATE,
		appendChunkFrames,
	);

	return buffer;
}

describe("computeLinkedDetection", () => {
	it("mono: detection equals abs(sample) at each frame", async () => {
		const channel = new Float32Array([1, -2, 0.5, -0.25]);
		const buffer = await makeBufferFromChannels([channel]);

		const result = await computeLinkedDetection(buffer);

		expect(Array.from(result)).toEqual([1, 2, 0.5, 0.25]);
	});

	it("stereo: detection equals max(abs(L), abs(R)) at each frame", async () => {
		const left = new Float32Array([1, -2, 0]);
		const right = new Float32Array([-3, 1, 2]);
		const buffer = await makeBufferFromChannels([left, right]);

		const result = await computeLinkedDetection(buffer);

		expect(Array.from(result)).toEqual([3, 2, 2]);
	});

	it("empty buffer: returns a length-0 envelope without iterating", async () => {
		const buffer = await makeBufferFromChannels([new Float32Array(0)]);

		const result = await computeLinkedDetection(buffer);

		expect(result).toBeInstanceOf(Float32Array);
		expect(result.length).toBe(0);
	});

	it("multi-chunk: result is byte-identical across different chunk sizes", async () => {
		// Build a 1024-frame stereo source with deterministic content.
		const frameCount = 1024;
		const left = new Float32Array(frameCount);
		const right = new Float32Array(frameCount);

		for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
			left[frameIndex] = Math.sin((2 * Math.PI * frameIndex) / 64) * 0.7;
			right[frameIndex] = Math.cos((2 * Math.PI * frameIndex) / 91) * 0.5 - 0.1;
		}

		// Append-chunk sizes spanning < CHUNK_FRAMES so iterate has to
		// stitch multiple internal segments per yielded chunk.
		const bufferA = await makeBufferFromChannels([left, right], 17);
		const bufferB = await makeBufferFromChannels([left, right], 256);
		const bufferC = await makeBufferFromChannels([left, right], 1024);

		const resultA = await computeLinkedDetection(bufferA);
		const resultB = await computeLinkedDetection(bufferB);
		const resultC = await computeLinkedDetection(bufferC);

		expect(resultA.length).toBe(frameCount);
		expect(resultB.length).toBe(frameCount);
		expect(resultC.length).toBe(frameCount);

		// Byte-equal across all three.
		expect(new Uint8Array(resultA.buffer)).toEqual(new Uint8Array(resultB.buffer));
		expect(new Uint8Array(resultA.buffer)).toEqual(new Uint8Array(resultC.buffer));

		// And matches the direct max(|L|, |R|) reference.
		const expected = new Float32Array(frameCount);

		for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
			expected[frameIndex] = Math.max(Math.abs(left[frameIndex]!), Math.abs(right[frameIndex]!));
		}

		expect(new Uint8Array(resultA.buffer)).toEqual(new Uint8Array(expected.buffer));
	});
});
