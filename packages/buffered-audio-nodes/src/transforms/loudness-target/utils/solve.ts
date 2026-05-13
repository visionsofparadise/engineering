/**
 * Histogram-based LUFS predictor for the loudnessTarget node — used
 * ONCE before iteration to seed the iteration's initial `B`. Per the
 * `plan-loudness-target-deterministic` 2026-05-13 revert: the predictor
 * is too approximate (~2 LUFS error on high-crest-factor speech) to be
 * the source of truth, so the prior 2D `iterateForTargets` loop is
 * restored and the predictor is reduced to a seeder. Iteration's secant
 * + proportional feedback converges to the actual target within
 * `tolerance`; the seed just shifts attempt 1 closer to convergence.
 *
 * ## The predictor
 *
 * The K-weighted integrated LUFS shift from applying a per-sample gain
 * `g[n] = 10^(gainDbAt(detection[n], anchors) / 20)` to the source is,
 * to a good approximation,
 *
 *   ΔLUFS ≈ 10 · log10( E_signal[ g² ] )
 *           = 10 · log10( Σ_n |x[n]|² · g²(|x[n]|) / Σ_n |x[n]|² )
 *
 * where the expectation is **energy-weighted** — each sample
 * contributes in proportion to `|x|²`, mirroring BS.1770's mean-of-RMS.
 * `predictOutputLufs` walks the source's detection-amplitude histogram
 * (surfaced on the measurement as `detectionHistogram`), evaluates
 * `g(bucketCentreDb)` at each bucket centre on the same dBFS axis the
 * apply path drives `gainDbAt` on, and weights by
 * `bucketCount · bucketCentreLinear²`:
 *
 * ## Histogram axis (post-2026-05-13 fix)
 *
 * `detectionHistogram` is built on the POOLED base-rate axis (raw 4× →
 * max-of-4 → `SlidingWindowMaxStream(halfWidth)`), the SAME axis the
 * curve evaluates on in the apply path. This is correct for the
 * `limitAutoDb` percentile walk — `limitDb` is now calibrated against
 * the distribution the curve actually sees.
 *
 * The same histogram is used here. The energy-weighting math
 * (`count · centreLinear²`) treats each bucket as if it were a per-
 * sample source-amplitude bucket — but on the pooled axis pooled
 * amplitudes are systematically higher than per-sample source
 * amplitudes (a pooled sample is the max over ~`(2·halfWidth+1)·4` raw
 * samples). The seed bias is upward (predictor over-estimates how loud
 * the gained output will be) but bounded; iteration's secant corrects
 * the rest. ACCEPTED TRADE-OFF: a single histogram for both consumers
 * (no double measurement walk, no second histogram allocation).
 *
 *   weighted_g² = Σ_b count[b] · centreLinear[b]² · g²(centreDb[b])
 *   total_x²    = Σ_b count[b] · centreLinear[b]²
 *   predictedLufs ≈ sourceLufs + 10 · log10( weighted_g² / total_x² )
 *
 * ## Approximation caveats
 *
 * Honest about what the mean-square-gain proxy gives up — these are why
 * the predictor is now a seeder rather than the source of truth:
 *
 * - **Rate-flat K-filter.** Real BS.1770 K-filtering applies a high-
 *   pass at ~38 Hz and a ~+4 dB shelf above ~1.5 kHz; the proxy treats
 *   the K-filter as flat across the spectrum. Speech with mid-band
 *   energy dominance is mildly affected (~0.1-0.5 LUFS); strongly
 *   sub-bass-heavy or treble-heavy content can drift further.
 * - **No block gating.** BS.1770 integrated LUFS gates 400 ms blocks
 *   absolute at -70 LUFS and relative at -10 LU below the absolute-
 *   gated mean. The proxy weights every detection-envelope sample
 *   equally including ones BS.1770 would gate out.
 * - **Gain/signal correlation.** `10·log10(E[g²])` assumes the gain
 *   envelope and the K-filtered signal are approximately uncorrelated
 *   over the block scale.
 *
 * Together these produce a typical residual of ~0.5 LUFS on real
 * material and ~2 LUFS on high-crest-factor speech (Pierce ep 060).
 * Acceptable as a seed; not acceptable as the final answer.
 */

import type { DetectionHistogram } from "./measurement";
import { type Anchors, gainDbAt } from "./curve";
import { BOOST_LOWER_BOUND, BOOST_UPPER_BOUND } from "./iterate";

export { BOOST_LOWER_BOUND, BOOST_UPPER_BOUND };

/** Linear-amplitude floor below which a bucket's contribution to E[g²] is treated as zero. */
const LINEAR_AMPLITUDE_EPSILON = 1e-12;

/**
 * Predict the BS.1770 integrated LUFS that an output stream would
 * measure if every sample were gain-shifted by `gainDbAt(absXDb,
 * anchors)` where `absXDb = linearToDb(|x|)`. Energy-weighted
 * expectation over the detection-amplitude histogram (see file header):
 *
 *   weighted_g² = Σ_b count[b] · centreLinear[b]² · g²(centreDb[b])
 *   total_x²    = Σ_b count[b] · centreLinear[b]²
 *   predictedLufs ≈ sourceLufs + 10 · log10( weighted_g² / total_x² )
 *
 * The `centreLinear²` weighting mirrors BS.1770's mean-of-RMS.
 *
 * The histogram is on the POOLED base-rate axis (post-2026-05-13 fix —
 * see file header). The energy-weighting math is unchanged but is
 * applied to a pooled distribution; the resulting predicted-LUFS shift
 * is biased upward vs the true per-sample expectation. The downstream
 * `predictInitialB` bisection consumes this only as an initial seed for
 * iteration — the secant + proportional feedback inside
 * `iterateForTargets` close the residual.
 *
 * Returns `-Infinity` for silent / empty histograms.
 */
export function predictOutputLufs(
	sourceLufs: number,
	anchors: Anchors,
	histogram: DetectionHistogram,
): number {
	const { buckets, bucketMax, totalSamples } = histogram;
	const bucketCount = buckets.length;

	if (bucketCount === 0 || bucketMax <= 0 || totalSamples === 0) return -Infinity;
	if (!Number.isFinite(sourceLufs)) return -Infinity;

	const bucketWidth = bucketMax / bucketCount;
	let weightedGainEnergy = 0;
	let weightedSourceEnergy = 0;

	for (let bucketIdx = 0; bucketIdx < bucketCount; bucketIdx++) {
		const count = buckets[bucketIdx] ?? 0;

		if (count === 0) continue;

		const centreLinear = (bucketIdx + 0.5) * bucketWidth;

		if (centreLinear < LINEAR_AMPLITUDE_EPSILON) continue;

		const energy = count * centreLinear * centreLinear;
		const centreDb = 20 * Math.log10(centreLinear);
		const gainDb = gainDbAt(centreDb, anchors);
		const gainLinear = Math.pow(10, gainDb / 20);

		weightedSourceEnergy += energy;
		weightedGainEnergy += energy * gainLinear * gainLinear;
	}

	if (weightedSourceEnergy <= 0 || weightedGainEnergy <= 0) return -Infinity;

	const lufsShift = 10 * Math.log10(weightedGainEnergy / weightedSourceEnergy);

	return sourceLufs + lufsShift;
}

/**
 * Maximum bisection iterations for `predictInitialB`. `log2((upper -
 * lower) / tolerance) ≈ 10` for a 60 dB bracket and 0.1 LUFS exit; we
 * allow 50 for sub-tolerance refinement and to absorb any flat regions
 * of the predictor.
 */
const MAX_BISECT_ITERATIONS = 50;

export interface PredictInitialBArgs {
	readonly sourceLufs: number;
	readonly targetLufs: number;
	/**
	 * Pre-clamped curve anchors with the SOLVED `limitDb` already set.
	 * `peakGainDb` carries the closed-form `targetTp − limitDb` (or
	 * `B`-tracking semantic in the degenerate brick-wall-dormant
	 * branch). `predictInitialB` keeps `peakGainDb` updated against the
	 * candidate `B` when the brick-wall is dormant.
	 */
	readonly anchors: Pick<Anchors, "floorDb" | "pivotDb" | "limitDb">;
	readonly histogram: DetectionHistogram;
	/**
	 * `true` when `sourceTpDb ≤ limitDb` — the brick-wall extension is
	 * dormant, so `peakGainDb = B` (continuous slope through the limit
	 * anchor). `false` otherwise; the caller supplies a constant
	 * `closedFormPeakGainDb`.
	 */
	readonly brickWallDormant: boolean;
	/**
	 * Closed-form `peakGainDb = targetTp − limitDb` when the brick-wall
	 * is engaged. Ignored when `brickWallDormant` is `true`.
	 */
	readonly closedFormPeakGainDb: number;
	/** LUFS tolerance for the bisection exit gate. */
	readonly tolerance: number;
}

/**
 * Predictor-only bisection on `B` against `targetLufs` over
 * `[BOOST_LOWER_BOUND, BOOST_UPPER_BOUND]`. Returns the `B` for which
 * `predictOutputLufs(B, anchors, histogram) ≈ targetLufs`. Microseconds
 * — no apply pass, no envelope build, no measurement; pure histogram
 * math.
 *
 * The result is a SEED for `iterateForTargets`. Iteration's secant
 * still drives convergence to within tolerance; the seed just shifts
 * attempt 1 closer.
 *
 * When the target is unreachable across the bracket (predictor never
 * crosses `targetLufs`), returns the bracket bound with the smaller
 * residual.
 */
export function predictInitialB(args: PredictInitialBArgs): number {
	const {
		sourceLufs,
		targetLufs,
		anchors: anchorBase,
		histogram,
		brickWallDormant,
		closedFormPeakGainDb,
		tolerance,
	} = args;

	if (!Number.isFinite(sourceLufs)) return 0;

	const predictAt = (candidateB: number): number => {
		const candidatePeakGainDb = brickWallDormant ? candidateB : closedFormPeakGainDb;
		const candidateAnchors: Anchors = {
			floorDb: anchorBase.floorDb,
			pivotDb: anchorBase.pivotDb,
			limitDb: anchorBase.limitDb,
			B: candidateB,
			peakGainDb: candidatePeakGainDb,
		};

		return predictOutputLufs(sourceLufs, candidateAnchors, histogram);
	};

	let lower = BOOST_LOWER_BOUND;
	let upper = BOOST_UPPER_BOUND;
	const lowerLufs = predictAt(lower);
	const upperLufs = predictAt(upper);
	const lowerErr = lowerLufs - targetLufs;
	const upperErr = upperLufs - targetLufs;

	if (!Number.isFinite(lowerErr) || !Number.isFinite(upperErr) || Math.sign(lowerErr) === Math.sign(upperErr)) {
		// No root in bracket — return the boundary with the smaller
		// residual. Iteration's secant takes it from there.
		const lowerAbs = Number.isFinite(lowerErr) ? Math.abs(lowerErr) : Infinity;
		const upperAbs = Number.isFinite(upperErr) ? Math.abs(upperErr) : Infinity;

		return lowerAbs <= upperAbs ? lower : upper;
	}

	let bestB = lower;
	let bestAbsErr = Math.abs(lowerErr);
	let workingLowerErr = lowerErr;
	const subToleranceBracket = tolerance / 100;

	for (let iteration = 0; iteration < MAX_BISECT_ITERATIONS; iteration++) {
		const mid = 0.5 * (lower + upper);
		const midErr = predictAt(mid) - targetLufs;

		if (Math.abs(midErr) < bestAbsErr || iteration === 0) {
			bestB = mid;
			bestAbsErr = Math.abs(midErr);
		}

		if (Math.abs(midErr) < tolerance) {
			bestB = mid;
			break;
		}

		if (!Number.isFinite(midErr) || Math.sign(midErr) === Math.sign(workingLowerErr)) {
			lower = mid;
			workingLowerErr = midErr;
		} else {
			upper = mid;
		}

		if (upper - lower < subToleranceBracket) break;
	}

	return bestB;
}
