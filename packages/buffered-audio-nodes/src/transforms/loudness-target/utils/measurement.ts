import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import {
	AmplitudeHistogramAccumulator,
	LoudnessAccumulator,
	Oversampler,
	TruePeakAccumulator,
	dbToLinear,
	getLraConsideredStats,
	linearToDb,
} from "@e9g/buffered-audio-nodes-utils";
import { OVERSAMPLE_FACTOR } from "./iterate";

/**
 * Combined source measurement for the loudnessTarget node.
 *
 * Per design-loudness-target §"Pipeline shape": pass 1 measures
 * integrated LUFS, LRA, and 4× true peak in a single chunked walk
 * through the source. The expander's `measurement.ts` measures only
 * integrated LUFS (no peak anchor); this module extends that pattern
 * with a parallel {@link TruePeakAccumulator} and uses
 * {@link LoudnessAccumulator} (rather than `IntegratedLufsAccumulator`)
 * to get LRA in the same pass.
 *
 * The pass also carries a per-channel {@link Oversampler} array and an
 * {@link AmplitudeHistogramAccumulator} over the 4×-rate max-linked
 * detection signal `levels[k] = max_c |upChannels[c][k]|`. This is the
 * SAME signal that walk A computes per attempt in `iterate.ts`'s
 * `streamDetectionMaxPoolAndCurveAndForwardIir` — matching domains so
 * the percentile-derived `limitAutoDb` lands on the same axis the
 * curve's brick-wall branch evaluates on (per plan §"Open question O2").
 *
 * Walk granularity matches the rest of the loudness sub-system
 * (`44_100` frames per chunk). All accumulators consume the same
 * per-chunk channel slices in lockstep — single source pass, constant
 * memory beyond the bounded accumulator state.
 */

/**
 * Iteration chunk size — one second's worth of frames at 44.1 kHz.
 * Matches the convention in `loudness-expander/utils/measurement.ts`.
 */
const CHUNK_FRAMES = 44_100;

/**
 * Histogram bucket count for the detection-envelope amplitude histogram.
 * 1024 matches `AmplitudeHistogramAccumulator`'s typical resolution and
 * is well beyond what the percentile walk needs for level precision.
 */
const HISTOGRAM_BUCKETS = 1024;

/**
 * Fallback pivot for the silent-source / no-considered-blocks case.
 * Mirrors the same `-40 dBFS` fallback used in `index.ts`'s pivot auto-
 * derivation when `pivotAutoDb` is `+Infinity`. Keeps `dbToLinear`
 * finite so the start-bucket index is well-defined.
 */
const PIVOT_FALLBACK_DB = -40;

export interface SourceMeasurement {
	/**
	 * BS.1770-4 integrated loudness in LUFS. `-Infinity` for silent /
	 * sub-block-length signals; the caller treats this as a
	 * pass-through bail signal (no curve to fit).
	 */
	readonly integratedLufs: number;
	/**
	 * EBU Tech 3342 Loudness Range in LU. `0` when fewer than two
	 * short-term blocks survive the LRA two-stage gate (typical for
	 * sources < ~6 s or perfectly stationary content).
	 */
	readonly lra: number;
	/**
	 * 4× upsampled true peak in dBTP. `-Infinity` for silent input
	 * (linear amplitude 0 → `linearToDb` returns `-Infinity`).
	 */
	readonly truePeakDb: number;
	/**
	 * `median(consideredLra)` from the BS.1770 / EBU R128 LRA two-stage
	 * gate (absolute -70 LUFS, relative -20 LU below absolute-gated
	 * mean) computed in pass 1 over the short-term block series. Used
	 * directly as a detection-axis dBFS value (no unit conversion) by
	 * the auto-derived `pivot` default in the loudnessTarget node —
	 * the "typical body level" anchor. Median is robust to both
	 * transient-heavy and noise-floor-heavy tails of the considered
	 * set.
	 *
	 * `Number.POSITIVE_INFINITY` when no short-term blocks survive
	 * gating (empty `shortTerm` for sources < 3 s, or every block
	 * below the absolute -70 LUFS gate). Callers fall back to a
	 * sentinel pivot value in that case.
	 */
	readonly pivotAutoDb: number;
	/**
	 * `min(consideredLra)` from the BS.1770 / EBU R128 LRA two-stage
	 * gate computed in pass 1. Used as the auto-derived `floor`
	 * default in the loudnessTarget node — the absolute lower bound
	 * of the gain-riding zone (samples below this level were not
	 * loud enough to participate in perceived loudness). Pairs with
	 * the median `pivotAutoDb`: pivot=median sets the body anchor,
	 * floor=min sets the lower-segment roll-off start.
	 *
	 * `Number.POSITIVE_INFINITY` when no short-term blocks survive
	 * gating. Callers fall back to no-floor in that case.
	 */
	readonly floorAutoDb: number;
	/**
	 * Percentile-derived level on the 4×-rate max-linked detection
	 * histogram, restricted to the `[pivotAutoDb, sourcePeakDb]`
	 * window. Returned in dBFS (negative for sub-unity amplitudes;
	 * computed via `linearToDb` of the bucket centre at the percentile).
	 *
	 * Semantics: the dB level above which the top
	 * `(1 - limitPercentile)` fraction of detection samples sit — the
	 * brick-wall threshold for those rare-tail peaks. Consumed by the
	 * loudnessTarget iterator as the fixed `limitDb` anchor when no
	 * explicit override is provided.
	 *
	 * `Number.POSITIVE_INFINITY` when the source is silent
	 * (`bucketMax === 0` / no samples) or the post-pivot histogram
	 * window contains fewer samples than the percentile target —
	 * degenerate cases where there is no useful limiting headroom.
	 * Callers fall back to `sourcePeakDb` in those cases (no limiting
	 * — the brick-wall branch never engages).
	 */
	readonly limitAutoDb: number;
}

/**
 * Walk a `ChunkBuffer` once and return integrated LUFS, LRA, 4× true
 * peak, the auto pivot/floor stats, and the auto limit threshold from
 * a top-down percentile walk over the post-pivot detection histogram.
 * All accumulators consume the same chunked walk; the result is fed
 * to the iteration loop's anchor / target setup in `iterate.ts`.
 *
 * `limitPercentile` selects which fraction of detection samples falls
 * AT OR BELOW the returned level. With `limitPercentile = 0.995` the
 * top 0.5% of detection samples are above `limitAutoDb` and get
 * brick-walled by the curve's upper branch.
 *
 * Returns `-Infinity` for `integratedLufs` and / or `truePeakDb` on
 * silent input — propagated as-is for the caller to detect and short
 * the pipeline. `lra = 0` is propagated as-is too; iteration handles
 * the short-source case by skipping LRA convergence.
 */
export async function measureSource(buffer: ChunkBuffer, sampleRate: number, limitPercentile: number): Promise<SourceMeasurement> {
	const frames = buffer.frames;
	const channelCount = buffer.channels;

	if (frames === 0 || channelCount === 0) {
		return {
			integratedLufs: -Infinity,
			lra: 0,
			truePeakDb: -Infinity,
			pivotAutoDb: Number.POSITIVE_INFINITY,
			floorAutoDb: Number.POSITIVE_INFINITY,
			limitAutoDb: Number.POSITIVE_INFINITY,
		};
	}

	const loudness = new LoudnessAccumulator(sampleRate, channelCount);
	const truePeak = new TruePeakAccumulator(sampleRate, channelCount);
	const detectionHistogram = new AmplitudeHistogramAccumulator(HISTOGRAM_BUCKETS);
	// Per-channel oversamplers carry biquad state across chunks within
	// THIS measurement pass only. Distinct from walk A's per-attempt
	// `detectionOversamplers` (fresh per attempt) and the stream
	// class's persistent apply oversamplers — different signal histories.
	const oversamplers: Array<Oversampler> = [];

	for (let channelIdx = 0; channelIdx < channelCount; channelIdx++) {
		oversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
	}

	// Reused scratch buffer for the 4×-rate max-linked detection signal.
	// Allocated lazily on the first chunk and resized only when a chunk
	// is larger than the largest seen so far (typically once, on the
	// first chunk). Avoids per-chunk allocation in the inner loop.
	let levelsScratch: Float32Array | null = null;

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const chunkFrames = chunk.samples[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		loudness.push(chunk.samples, chunkFrames);
		truePeak.push(chunk.samples, chunkFrames);

		// Upsample each channel to 4× rate. Per-channel result is a
		// fresh `Float32Array` of length `chunkFrames * factor` from
		// `Oversampler.upsample`'s contract.
		const upChannels: Array<Float32Array> = [];

		for (let channelIdx = 0; channelIdx < chunk.samples.length; channelIdx++) {
			const channel = chunk.samples[channelIdx];
			const oversampler = oversamplers[channelIdx];

			if (channel === undefined || oversampler === undefined) {
				upChannels.push(new Float32Array(chunkFrames * OVERSAMPLE_FACTOR));
				continue;
			}

			upChannels.push(oversampler.upsample(channel));
		}

		const upChunkLength = chunkFrames * OVERSAMPLE_FACTOR;

		if (levelsScratch === null || levelsScratch.length < upChunkLength) {
			levelsScratch = new Float32Array(upChunkLength);
		}

		const levels = levelsScratch;

		// 4×-rate max-linked detection signal:
		// `levels[k] = max_c |upChannels[c][k]|`. Same domain the curve
		// evaluates on per plan §"Open question O2" — captures inter-
		// sample peaks so the percentile lands where the brick-wall above
		// `limitDb` will actually see them.
		for (let upIdx = 0; upIdx < upChunkLength; upIdx++) {
			let max = 0;

			for (let channelIdx = 0; channelIdx < upChannels.length; channelIdx++) {
				const upSample = upChannels[channelIdx]?.[upIdx] ?? 0;
				const absolute = Math.abs(upSample);

				if (absolute > max) max = absolute;
			}

			levels[upIdx] = max;
		}

		// Push as a single-channel buffer of length `upChunkLength` —
		// the scratch may be wider on later chunks, but the accumulator
		// reads exactly `frames` samples from each channel.
		detectionHistogram.push([levels], upChunkLength);
	}

	const loudnessResult = loudness.finalize();
	const truePeakLin = truePeak.finalize();
	const histogramResult = detectionHistogram.finalize();
	const stats = getLraConsideredStats(loudnessResult.shortTerm);

	const limitAutoDb = computeLimitAutoDb(histogramResult.buckets, histogramResult.bucketMax, stats.median, limitPercentile);

	return {
		integratedLufs: loudnessResult.integrated,
		lra: loudnessResult.range,
		truePeakDb: linearToDb(truePeakLin),
		pivotAutoDb: stats.median,
		floorAutoDb: stats.min,
		limitAutoDb,
	};
}

/**
 * Derive `limitAutoDb` via a top-down percentile walk over the
 * detection histogram. Walks bucket indices from the highest down to
 * the `pivotAutoDb`-aligned start bucket, accumulating sample counts
 * until the cumulative count reaches `totalSamples * (1 -
 * limitPercentile)`. That bucket's centre, converted back to dBFS via
 * {@link linearToDb}, is `limitAutoDb`.
 *
 * Semantics: with `limitPercentile = 0.995` the top 0.5% of detection
 * samples sit above the returned level. Adapts to source distribution
 * shape without conflating "rare tail" with "shape elbow" — a single,
 * unambiguous statistical primitive.
 *
 * Returns `Number.POSITIVE_INFINITY` when the histogram is empty or
 * the post-pivot window holds fewer samples than the percentile
 * target (silent / degenerate sources). Callers fall back to
 * `sourcePeakDb` in that case so the brick-wall branch never engages.
 */
function computeLimitAutoDb(buckets: Uint32Array, bucketMax: number, pivotAutoDb: number, limitPercentile: number): number {
	if (bucketMax === 0) return Number.POSITIVE_INFINITY;

	// Total sample count = sum over all buckets. Bounded by bucket
	// count (1024) — cheap and avoids surfacing `totalSamples` from
	// the accumulator's finalize result just for this call site.
	let totalSamples = 0;

	for (let bucketIndex = 0; bucketIndex < buckets.length; bucketIndex++) {
		totalSamples += buckets[bucketIndex] ?? 0;
	}

	if (totalSamples === 0) return Number.POSITIVE_INFINITY;

	const bucketWidth = bucketMax / buckets.length;
	const effectivePivotDb = Number.isFinite(pivotAutoDb) ? pivotAutoDb : PIVOT_FALLBACK_DB;
	const pivotLinear = dbToLinear(effectivePivotDb);
	const rawStart = Math.floor(pivotLinear / bucketWidth);
	const startBucket = Math.min(buckets.length - 1, Math.max(0, rawStart));
	const targetCount = totalSamples * (1 - limitPercentile);

	let cumulative = 0;
	let limitBucket = -1;

	for (let bucketIndex = buckets.length - 1; bucketIndex >= startBucket; bucketIndex--) {
		cumulative += buckets[bucketIndex] ?? 0;

		if (cumulative >= targetCount) {
			limitBucket = bucketIndex;
			break;
		}
	}

	// Not enough samples in the post-pivot range to reach the
	// percentile threshold — degenerate. Fall back to no-limit
	// sentinel so callers treat the source as having no useful
	// limiting headroom.
	if (limitBucket === -1) return Number.POSITIVE_INFINITY;

	const linearLevel = (limitBucket + 0.5) * bucketWidth;

	return linearToDb(linearLevel);
}
