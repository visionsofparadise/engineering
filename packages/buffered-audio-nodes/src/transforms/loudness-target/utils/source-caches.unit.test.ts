import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { Oversampler, SlidingWindowMaxStream } from "@e9g/buffered-audio-nodes-utils";
import { describe, expect, it } from "vitest";
import { CHUNK_FRAMES, OVERSAMPLE_FACTOR } from "./iterate";
import { buildSourceUpsampledAndDetectionCaches } from "./source-caches";

const SAMPLE_RATE = 48_000;

/** LCG (numerical-recipes constants) for deterministic noise. */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

		return state / 0x80_00_00_00 - 1;
	};
}

function makeSineWithNoise(seed: number, frames: number, amplitude: number, frequency: number): Float32Array {
	const channel = new Float32Array(frames);
	const rand = makeLcg(seed);
	const angularStep = (2 * Math.PI * frequency) / SAMPLE_RATE;

	for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
		channel[frameIdx] = amplitude * (0.7 * Math.sin(angularStep * frameIdx) + 0.3 * rand());
	}

	return channel;
}

async function makeBufferFromChannels(channels: ReadonlyArray<Float32Array>): Promise<ChunkBuffer> {
	const buffer = new ChunkBuffer();

	await buffer.write(channels.map((c) => new Float32Array(c)), SAMPLE_RATE, 32);
	await buffer.flushWrites();

	return buffer;
}

/**
 * Read all frames from a ChunkBuffer into a flat per-channel
 * `Float32Array[]`. Used to compare cached output byte-equal against
 * reference single-pass output computed in test code. Uses sequential
 * `read` per the new API; rewinds via `reset()` first.
 */
async function readAll(buffer: ChunkBuffer): Promise<Array<Float32Array>> {
	const channelCount = buffer.channels;
	const totalFrames = buffer.frames;
	const out: Array<Float32Array> = [];

	for (let ch = 0; ch < channelCount; ch++) {
		out.push(new Float32Array(totalFrames));
	}

	if (totalFrames === 0) return out;

	await buffer.reset();
	const chunkSize = CHUNK_FRAMES * OVERSAMPLE_FACTOR;
	let offset = 0;

	while (offset < totalFrames) {
		const want = Math.min(chunkSize, totalFrames - offset);
		const chunk = await buffer.read(want);
		const got = chunk.samples[0]?.length ?? 0;

		if (got === 0) break;

		for (let ch = 0; ch < channelCount; ch++) {
			const src = chunk.samples[ch];
			const dst = out[ch];

			if (src && dst) dst.set(src, offset);
		}

		offset += got;
	}

	return out;
}

describe("buildSourceUpsampledAndDetectionCaches", () => {
	it("populates both caches with the expected frame counts", async () => {
		// Use ~2.5 chunks so we exercise both the steady-state path and
		// the trailing short chunk.
		const frames = Math.floor(CHUNK_FRAMES * 2.5);
		const channels = [
			makeSineWithNoise(0xABCD_1234, frames, 0.2, 440),
			makeSineWithNoise(0x1234_ABCD, frames, 0.25, 660),
		];
		const buffer = await makeBufferFromChannels(channels);
		const halfWidth = 50; // small smoothing for fast test

		const caches = await buildSourceUpsampledAndDetectionCaches({
			buffer,
			sampleRate: SAMPLE_RATE,
			channelCount: 2,
			frames,
			halfWidth,
		});

		try {
			expect(caches.upsampledSource.frames).toBe(frames * OVERSAMPLE_FACTOR);
			expect(caches.upsampledSource.channels).toBe(2);
			expect(caches.detectionEnvelope.frames).toBe(frames * OVERSAMPLE_FACTOR);
			expect(caches.detectionEnvelope.channels).toBe(1);
		} finally {
			await caches.upsampledSource.close();
			await caches.detectionEnvelope.close();
		}
	});

	it("upsampled cache contents match per-chunk Oversampler.upsample outputs concatenated", async () => {
		const frames = Math.floor(CHUNK_FRAMES * 1.75);
		const channels = [
			makeSineWithNoise(0xCAFE_BABE, frames, 0.3, 880),
			makeSineWithNoise(0xBADD_F00D, frames, 0.22, 1320),
		];
		const buffer = await makeBufferFromChannels(channels);

		const caches = await buildSourceUpsampledAndDetectionCaches({
			buffer,
			sampleRate: SAMPLE_RATE,
			channelCount: 2,
			frames,
			halfWidth: 100,
		});

		try {
			// Reference: walk the buffer chunk-by-chunk with a fresh
			// Oversampler set (matching the cache builder's setup) and
			// concatenate the per-chunk upsamples.
			const refOversamplers = [
				new Oversampler(OVERSAMPLE_FACTOR, SAMPLE_RATE),
				new Oversampler(OVERSAMPLE_FACTOR, SAMPLE_RATE),
			];
			const refChannels: Array<Float32Array> = [
				new Float32Array(frames * OVERSAMPLE_FACTOR),
				new Float32Array(frames * OVERSAMPLE_FACTOR),
			];
			let writeOffset = 0;

			await buffer.reset();
			for (;;) {
				const chunk = await buffer.read(CHUNK_FRAMES);
				const chunkFrames = chunk.samples[0]?.length ?? 0;

				if (chunkFrames === 0) break;

				for (let ch = 0; ch < 2; ch++) {
					const channel = chunk.samples[ch]!;
					const up = refOversamplers[ch]!.upsample(channel);

					refChannels[ch]!.set(up, writeOffset);
				}

				writeOffset += chunkFrames * OVERSAMPLE_FACTOR;
				if (chunkFrames < CHUNK_FRAMES) break;
			}

			const got = await readAll(caches.upsampledSource);

			for (let ch = 0; ch < 2; ch++) {
				const ref = refChannels[ch]!;
				const gotCh = got[ch]!;

				expect(gotCh.length).toBe(ref.length);

				let maxDiff = 0;

				for (let i = 0; i < ref.length; i++) {
					const diff = Math.abs(ref[i]! - gotCh[i]!);

					if (diff > maxDiff) maxDiff = diff;
				}

				expect(maxDiff).toBe(0);
			}
		} finally {
			await caches.upsampledSource.close();
			await caches.detectionEnvelope.close();
		}
	});

	it("detection envelope matches reference: max-link then SlidingWindowMaxStream over per-chunk upsamples", async () => {
		const frames = Math.floor(CHUNK_FRAMES * 1.3);
		const channels = [
			makeSineWithNoise(0xFEED_DEAD, frames, 0.4, 1000),
			makeSineWithNoise(0x5A5A_A5A5, frames, 0.35, 1500),
		];
		const buffer = await makeBufferFromChannels(channels);
		const halfWidth = 200;

		const caches = await buildSourceUpsampledAndDetectionCaches({
			buffer,
			sampleRate: SAMPLE_RATE,
			channelCount: 2,
			frames,
			halfWidth,
		});

		try {
			// Reference: replicate the cache builder's interior — fresh
			// oversamplers, fresh sliding window, fused walk — into a
			// single flat array so we can compare byte-equal.
			const refOversamplers = [
				new Oversampler(OVERSAMPLE_FACTOR, SAMPLE_RATE),
				new Oversampler(OVERSAMPLE_FACTOR, SAMPLE_RATE),
			];
			const slidingWindow = new SlidingWindowMaxStream(halfWidth);
			const upsampledTotal = frames * OVERSAMPLE_FACTOR;
			const refDetection = new Float32Array(upsampledTotal);
			let detectionWriteOffset = 0;
			let consumed = 0;

			await buffer.reset();
			for (;;) {
				const chunk = await buffer.read(CHUNK_FRAMES);
				const chunkFrames = chunk.samples[0]?.length ?? 0;

				if (chunkFrames === 0) break;

				const upChunkLength = chunkFrames * OVERSAMPLE_FACTOR;
				const upChannels: Array<Float32Array> = [];

				for (let ch = 0; ch < 2; ch++) {
					upChannels.push(refOversamplers[ch]!.upsample(chunk.samples[ch]!));
				}

				const detectChunk = new Float32Array(upChunkLength);

				for (let upIdx = 0; upIdx < upChunkLength; upIdx++) {
					let max = 0;

					for (let ch = 0; ch < 2; ch++) {
						const v = Math.abs(upChannels[ch]?.[upIdx] ?? 0);

						if (v > max) max = v;
					}

					detectChunk[upIdx] = max;
				}

				consumed += upChunkLength;
				const isFinal = consumed >= upsampledTotal;
				const pooled = slidingWindow.push(detectChunk, isFinal);

				if (pooled.length > 0) {
					refDetection.set(pooled, detectionWriteOffset);
					detectionWriteOffset += pooled.length;
				}

				if (chunkFrames < CHUNK_FRAMES) break;
			}

			expect(detectionWriteOffset).toBe(upsampledTotal);

			const got = await readAll(caches.detectionEnvelope);

			expect(got[0]!.length).toBe(refDetection.length);

			let maxDiff = 0;

			for (let i = 0; i < refDetection.length; i++) {
				const diff = Math.abs(refDetection[i]! - got[0]![i]!);

				if (diff > maxDiff) maxDiff = diff;
			}

			expect(maxDiff).toBe(0);
		} finally {
			await caches.upsampledSource.close();
			await caches.detectionEnvelope.close();
		}
	});

	it("handles zero-frame source by returning empty buffers", async () => {
		const buffer = await makeBufferFromChannels([new Float32Array(0)]);

		const caches = await buildSourceUpsampledAndDetectionCaches({
			buffer,
			sampleRate: SAMPLE_RATE,
			channelCount: 1,
			frames: 0,
			halfWidth: 100,
		});

		try {
			expect(caches.upsampledSource.frames).toBe(0);
			expect(caches.detectionEnvelope.frames).toBe(0);
		} finally {
			await caches.upsampledSource.close();
			await caches.detectionEnvelope.close();
		}
	});
});
