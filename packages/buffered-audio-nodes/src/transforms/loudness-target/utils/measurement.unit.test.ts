import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { describe, expect, it } from "vitest";
import { measureSource } from "./measurement";

const SAMPLE_RATE = 48_000;

/** Provisional default percentile from plan §"Approach" item 1. */
const LIMIT_PERCENTILE = 0.995;

/**
 * Wrap per-channel synthetic arrays in a `ChunkBuffer`. Mirrors
 * the helper from `iterate.unit.test.ts`.
 */
async function makeBufferFromChannels(channels: ReadonlyArray<Float32Array>): Promise<ChunkBuffer> {
	const buffer = new ChunkBuffer();

	await buffer.write(channels.map((channel) => new Float32Array(channel)), SAMPLE_RATE, 32);
	await buffer.flushWrites();

	return buffer;
}

/** LCG (numerical-recipes constants) for deterministic noise. */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

		return state / 0x80_00_00_00 - 1;
	};
}

describe("measureSource — limitAutoDb (top-down percentile walk)", () => {
	it("sine source with anomalous transients → limitAutoDb sits in the upper portion of the detection range", async () => {
		// 8-second mono 220 Hz sine at body amplitude 0.05 (≈ -26 dBFS
		// linear peak) with rare anomalous transients at 0.7 amplitude
		// (≈ -3 dBFS) sprinkled at low density. The percentile walk
		// from the top accumulates the rare-tail transient buckets
		// first, then descends through (mostly empty) intermediate
		// buckets until reaching the dense sine-body buckets near
		// 0.05. With `limitPercentile = 0.995` (target ≈ 0.5% of
		// total detection samples) the cumulative count is exceeded
		// somewhere between the transient cluster and the upper
		// envelope of the sine body — i.e. the upper portion of the
		// detection range, well above the pivot (median body level)
		// and below the true peak (transient level).
		const durationSeconds = 8;
		const frames = SAMPLE_RATE * durationSeconds;
		const channel = new Float32Array(frames);
		const angularStep = (2 * Math.PI * 220) / SAMPLE_RATE;
		const rand = makeLcg(0xAB_CD_12_34);

		for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
			channel[frameIndex] = 0.05 * Math.sin(angularStep * frameIndex);
		}

		// Sprinkle anomalous transients: 1 transient per 200 ms,
		// each 4 samples wide at 0.7 amplitude. Total ≈ 40 transient
		// regions × 4 samples = 160 anomalous samples at base rate.
		const transientStride = Math.floor(SAMPLE_RATE * 0.2);
		const transientWidth = 4;

		for (let transientStart = transientStride; transientStart < frames - transientWidth; transientStart += transientStride) {
			const jitter = Math.floor(rand() * 1000);
			const start = Math.min(frames - transientWidth, Math.max(0, transientStart + jitter));

			for (let offset = 0; offset < transientWidth; offset++) {
				channel[start + offset] = 0.7 * Math.sign(channel[start + offset] ?? 1);
			}
		}

		const buffer = await makeBufferFromChannels([channel]);
		const result = await measureSource(buffer, SAMPLE_RATE, LIMIT_PERCENTILE);

		// Sanity: pivot finite and well below the transient level.
		expect(Number.isFinite(result.pivotAutoDb)).toBe(true);
		expect(Number.isFinite(result.truePeakDb)).toBe(true);
		expect(Number.isFinite(result.limitAutoDb)).toBe(true);

		// Quantitative band: the transient cluster supplies ~0.17 %
		// of the upsampled detection samples (well below the 0.5 %
		// target), so the walk descends past the transients (at
		// ~ -3 dBFS) through the sparsely-populated intermediate
		// buckets and into the upper envelope of the sine body
		// (linear-peak ≈ 0.05 → ≈ -26 dBFS). Observed: pivot ≈
		// -28.7 dBFS, limit ≈ -25.7 dBFS, peak ≈ -1.95 dBFS.
		expect(result.limitAutoDb).toBeGreaterThan(result.pivotAutoDb);
		expect(result.limitAutoDb).toBeLessThan(result.truePeakDb);
		expect(result.limitAutoDb).toBeGreaterThan(-28);
		expect(result.limitAutoDb).toBeLessThan(-22);
	});

	it("flat sine wave → limitAutoDb lands near the true peak", async () => {
		// Pure 220 Hz sine at amplitude 0.3. The 4×-rate max-linked
		// detection signal has the arcsine distribution — |x|
		// concentrates near the peak amplitude, so the histogram is
		// dense in the topmost buckets. Top-down walk to 0.5%
		// percentile target hits a near-top bucket almost immediately:
		// `limitAutoDb` lands within a small dB of `truePeakDb`.
		const durationSeconds = 8;
		const frames = SAMPLE_RATE * durationSeconds;
		const channel = new Float32Array(frames);
		const angularStep = (2 * Math.PI * 220) / SAMPLE_RATE;

		for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
			channel[frameIndex] = 0.3 * Math.sin(angularStep * frameIndex);
		}

		const buffer = await makeBufferFromChannels([channel]);
		const result = await measureSource(buffer, SAMPLE_RATE, LIMIT_PERCENTILE);

		expect(Number.isFinite(result.pivotAutoDb)).toBe(true);
		expect(Number.isFinite(result.truePeakDb)).toBe(true);
		expect(Number.isFinite(result.limitAutoDb)).toBe(true);

		expect(result.limitAutoDb).toBeGreaterThan(result.pivotAutoDb);
		expect(result.limitAutoDb).toBeLessThanOrEqual(result.truePeakDb);
		// Arcsine concentration → percentile sits within ~0.5 dB of
		// the true peak.
		expect(Math.abs(result.limitAutoDb - result.truePeakDb)).toBeLessThan(0.5);
	});

	it("silent source → limitAutoDb = +Infinity", async () => {
		// 8 seconds of pure zeros. `AmplitudeHistogramAccumulator`
		// reports bucketMax = 0; `computeLimitAutoDb` short-circuits
		// to the no-limit sentinel.
		const durationSeconds = 8;
		const frames = SAMPLE_RATE * durationSeconds;
		const channel = new Float32Array(frames);

		const buffer = await makeBufferFromChannels([channel]);
		const result = await measureSource(buffer, SAMPLE_RATE, LIMIT_PERCENTILE);

		expect(result.limitAutoDb).toBe(Number.POSITIVE_INFINITY);
	});
});
