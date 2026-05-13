import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { afterEach, describe, expect, it } from "vitest";
import { computeLinkedDetection } from "./detect";

const SAMPLE_RATE = 48_000;

/**
 * Per-file registry of `ChunkBuffer`s that must be closed at the end
 * of each test. `makeBufferFromChannels` pushes every buffer it
 * creates (including the empty-frame short-circuit path); the
 * `afterEach` hook drains and re-empties the list. Result buffers
 * are not tracked here because `computeLinkedDetection` returns a
 * `Float32Array`, not a buffer.
 */
const buffersToClose: Array<ChunkBuffer> = [];

/**
 * Wrap per-channel arrays in a `ChunkBuffer`. Mirrors the loudness-
 * shaper iterate test pattern. Returns a fresh buffer so the read
 * cursor walks from 0 each call.
 *
 * `writeChunkFrames` controls the granularity of the writes used to
 * populate the buffer (slicing each channel into successive `write`
 * calls), letting tests assert that the detection result is independent
 * of how the buffer was filled.
 */
async function makeBufferFromChannels(
	channels: ReadonlyArray<Float32Array>,
	writeChunkFrames = 32,
): Promise<ChunkBuffer> {
	const buffer = new ChunkBuffer();

	buffersToClose.push(buffer);

	const frameCount = channels[0]?.length ?? 0;

	if (frameCount === 0) {
		await buffer.write(
			channels.map(() => new Float32Array(0)),
			SAMPLE_RATE,
			32,
		);

		return buffer;
	}

	for (let start = 0; start < frameCount; start += writeChunkFrames) {
		const end = Math.min(start + writeChunkFrames, frameCount);
		const slice = channels.map((channel) => {
			const out = new Float32Array(end - start);

			out.set(channel.subarray(start, end));

			return out;
		});

		await buffer.write(slice, SAMPLE_RATE, 32);
	}

	return buffer;
}

describe("computeLinkedDetection", () => {
	afterEach(async () => {
		for (const buf of buffersToClose) {
			await buf.close();
		}

		buffersToClose.length = 0;
	});

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
