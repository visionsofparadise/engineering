/**
 * 1D secant iteration on body gain `B` for the loudnessTarget node.
 *
 * Per design-loudness-target §"Iteration" (post
 * `plan-loudness-target-percentile-limit` rewrite). Per design-transforms
 * §"Memory discipline": the source itself is streamed via
 * `buffer.iterate(CHUNK_FRAMES)`; never materialised as a full-source-
 * sized Float32Array at this level.
 *
 * Single perceptual target — `targetLufs` — converges on a single curve
 * parameter, body gain `B` (dB). The limit anchor `limitDb` is set
 * ONCE at iteration entry from the auto-derivation table:
 *   - `limitDbOverride` set         → use it (clamped)
 *   - else `limitAutoDb` finite     → use it (clamped) — this is the
 *     percentile-derived threshold from `measureSource`'s top-down walk
 *     over the 4×-rate detection-envelope histogram (per
 *     `plan-loudness-target-percentile-limit`)
 *   - else                          → `sourcePeakDb` (no limiting; the
 *     brick-wall branch is dormant for every sample)
 *
 * `limitDb` is constant across attempts: it is a statistical property
 * of the source (or a fixed user value), not something the iteration
 * negotiates. LRA falls out of the resulting geometry as a consequence
 * — there is no LRA target axis (see `plan-loudness-target-percentile-
 * limit` §"Decisions").
 *
 * The third axis, `peakGainDb` (upper-segment right-endpoint anchor),
 * starts at the closed-form `effectiveTargetTp − limitDb` and adjusts
 * per attempt via proportional feedback on observed `outputTruePeakDb`
 * overshoot — preserved from `plan-loudness-target-tp-iteration`. Since
 * `limitDb` is constant the closed-form baseline never changes; only
 * the feedback adjustment moves across attempts.
 *
 * When `peakGainDb > B` the upper segment of the curve is expansive
 * (positive slope between pivot and limit). This is geometrically valid
 * — the brick-wall above `limitDb` caps output at `targetTp` regardless
 * of slope sign. The `index.ts._process` log line surfaces this case
 * with an expansion warning so listeners notice intentional / accidental
 * tail-region amplification (per `plan-loudness-target-percentile-
 * limit` §"Open question O4").
 *
 * Pipeline per attempt (post-Phase-4 4×-upsampled fused-streaming form):
 *   1. Build anchors `{ floorDb, pivotDb, limitDb, B, peakGainDb }`.
 *   2. **Walk A — fused streaming 4×-upsampled detect + max-pool +
 *      curve + forward IIR**: stream the source once via
 *      `buffer.iterate(CHUNK_FRAMES)`, computing per chunk:
 *        - upsample each channel to 4× via a fresh per-channel
 *          `Oversampler` array (`detectionOversamplers`) allocated at
 *          walk start. Biquad state continues across chunks of THIS
 *          walk; the array is dropped at walk end.
 *        - 4×-rate linked detection `max_c |upChannels[c][upIdx]|` per
 *          upsampled sample,
 *        - peak-respecting max-pool via `SlidingWindowMaxStream` with
 *          `halfWidth = windowSamplesFromMs(smoothingMs, sampleRate *
 *          OVERSAMPLE_FACTOR)`,
 *        - curve evaluation `g[k] = 10^(gainDbAt(linearToDb(window[k])) /
 *          20)` per emitted upsampled output sample,
 *        - chunked forward HALF of the bidirectional IIR — constructed
 *          at `sampleRate * OVERSAMPLE_FACTOR`. State threads via
 *          `iir.applyForwardPass(gWindowChunk, forwardState)` across
 *          chunks.
 *      The forward-IIR result is written into a single transient
 *      `forwardScratch: Float32Array(frames * OVERSAMPLE_FACTOR)`
 *      allocated once outside the attempt loop and overwritten per
 *      attempt.
 *   3. **Walk B (sub-pass B1) — in-place backward IIR at 4× rate**:
 *      `iir.applyBackwardPassInPlace(forwardScratch)`. After this call
 *      `forwardScratch` IS the 4×-rate smoothed gain envelope.
 *   4. **Walk B (sub-pass B2) — apply + measure at 4× rate**: stream
 *      the source again with a fresh per-channel `Oversampler` array
 *      (`applyOversamplers`) allocated at walk-B start. Per chunk:
 *      `applyOversampledChunk` with the 4×-rate `forwardScratch` and
 *      the chunk's source-rate `offset`. Push transformed chunks into
 *      a fresh `LoudnessAccumulator` and `TruePeakAccumulator`.
 *      Finalize → `outputLufs`, `outputLra`, `outputTruePeakDb`.
 *      B1 must run BEFORE B2.
 *   5. Record `(B, lufsErr, peakErr, peakOvershoot, outputLra)`. On
 *      best-attempt update, defensively copy `forwardScratch` (size
 *      `frames * 4`) into a fresh `Float32Array`. Either converge or
 *      step.
 *
 * Stepping (1D on `B`):
 *   - Attempt 1 → 2 (one history point): full RMS-shift correction
 *     `B_next = B - lufsErr`.
 *   - Attempt ≥ 2: classical 1D secant on the most recent two history
 *     points; minimum slope `0.05` to avoid degenerate steps.
 *   - Step magnitude clamped to half the previous step (line-search
 *     damping) on attempts ≥ 2.
 *   - `B` clamped to `[-30, 30]` dB (sanity bound — avoids runaway on
 *     numerically degenerate sources).
 *
 * Proportional feedback on `peakGainDb`: after each attempt, if
 * `peakOvershoot > peakTolerance`, the next attempt's
 * `currentPeakGainDb` is shifted down by `peakOvershoot * PEAK_DAMPING`
 * (damped to avoid oscillation against the `B`-secant). Bounded below
 * by `PEAK_GAIN_DB_FLOOR`. Undershoot leaves the value untouched.
 *
 * Memory at peak (this module, post-Phase-4 4×-upsampled form):
 *   - One source-rate-×4 `forwardScratch` (`frames × OVERSAMPLE_FACTOR
 *     × 4 bytes`), allocated once outside the attempt loop and
 *     overwritten per attempt.
 *   - One source-rate-×4 winning smoothed envelope (`frames ×
 *     OVERSAMPLE_FACTOR × 4 bytes`, held by reference for the apply
 *     pass via `_unbuffer`).
 *   - Per-chunk per-channel upsampled scratch inside walk A; bounded.
 *   - Per-chunk 4×-rate detection scratch inside walk A; bounded.
 *   - Per-chunk 4×-rate curve-output scratch inside walk A; bounded.
 *   - Per-chunk transformed scratch inside walk B's measurement;
 *     bounded.
 *
 * Three distinct sets of `Oversampler` instances exist at runtime:
 *   1. `LoudnessTargetStream.oversamplers` — persistent, allocated at
 *      `_process` end, used by `_unbuffer` for the FINAL apply pass.
 *   2. `detectionOversamplers` — fresh per attempt inside walk A.
 *   3. `applyOversamplers` — fresh per attempt inside walk B sub-pass
 *      B2.
 * These cannot share state. Cross-pollination silently corrupts results
 * because the AA filter biquads have absorbed history.
 *
 * Best-attempt fallback: track the attempt with the smallest
 * `sqrt(lufsErr² + peakOvershoot²)` (peak overshoot is one-sided —
 * undershoot contributes 0). On `maxAttempts` exhaustion or joint
 * infeasibility, return that attempt's `gSmoothed` plus its `(B,
 * peakGainDb)` and `converged = false`. Same closest-attempt pattern as
 * the shaper / expander.
 *
 * `bestLimitDb` on `IterateResult` is a constant value (same across
 * all attempts) — kept for diagnostic continuity with the iteration-end
 * log line (per `plan-loudness-target-percentile-limit` §"Open
 * question O3").
 */

import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { BidirectionalIir, LoudnessAccumulator, Oversampler, SlidingWindowMaxStream, TruePeakAccumulator, linearToDb } from "@e9g/buffered-audio-nodes-utils";
import { applyOversampledChunk } from "./apply";
import { type Anchors, gainDbAt } from "./curve";
import { windowSamplesFromMs } from "./envelope";

/**
 * 4× oversampling factor for the upsampled detection / max-pool /
 * curve / IIR / apply pipeline. Mirrors `loudnessShaper`'s
 * `OVERSAMPLE_FACTOR`. The stream class re-imports this so the
 * `_unbuffer` apply pass uses the same factor as the iteration
 * walks (otherwise the persistent apply oversamplers would consume
 * the winning envelope at the wrong rate).
 */
export const OVERSAMPLE_FACTOR = 4;

/**
 * Streaming chunk size — one second of frames at 44.1 kHz. Matches the
 * convention in `loudness-expander/utils/iterate.ts` and the rest of
 * the loudness sub-system. Each iterated chunk allocates
 * `chunkFrames × channelCount × 4 bytes` of transformed scratch.
 */
export const CHUNK_FRAMES = 44_100;

/** Lower clamp on body gain `B` (dB). */
const BOOST_LOWER_BOUND = -30;
/** Upper clamp on body gain `B` (dB). */
const BOOST_UPPER_BOUND = 30;

/**
 * Minimum separation enforced internally between `pivotDb` and
 * `limitDb`. The upper-body segment of the curve is a linear ramp
 * normalised by `(limitDb − pivotDb)` (see `curve.ts:gainDbAt`); equal
 * values would divide by zero. 0.01 dB matches the floor↔pivot epsilon
 * for consistency — well below the audible JND for level and under any
 * measurement uncertainty.
 */
const LIMIT_EPSILON_DB = 0.01;

/**
 * Proportional-feedback damping factor for the per-attempt `peakGainDb`
 * adjustment. Each attempt, after measuring `outputTruePeakDb`, if the
 * observed overshoot exceeds `peakTolerance`, the next attempt's
 * `currentPeakGainDb` is shifted down by `peakOvershoot * PEAK_DAMPING`.
 * Damping `< 1` avoids oscillation against the `B`-secant — both axes
 * push the upper-segment slope, so a full-correction step on
 * `peakGainDb` would overshoot in the opposite direction once `B`
 * recompensates. `0.8` is the chosen starting value per Open Question
 * O1 in `plan-loudness-target-tp-iteration`.
 */
const PEAK_DAMPING = 0.8;

/**
 * Lower bound on `currentPeakGainDb`. Caps the cumulative attenuation
 * the proportional-feedback loop can apply to peak samples at 60 dB
 * below the closed-form baseline — well beyond any plausible mastering
 * scenario. Without a floor the loop could chase a mathematically
 * unreachable target to `-Infinity`. Mirrors the spirit of
 * `BOOST_LOWER_BOUND`.
 */
const PEAK_GAIN_DB_FLOOR = -60;

/**
 * Minimum |slope| for the 1D secant's `B`-axis step. Treated as ±0.05
 * below this magnitude (matches the shaper / expander's
 * MIN_SECANT_SLOPE pattern). Prevents degenerate stepping when two
 * consecutive attempts produced near-identical LUFS errors.
 */
const MIN_SECANT_SLOPE = 0.05;

/**
 * Max attempts (default; user-tunable via the schema). Matches the
 * shaper / expander defaults so the loudness sub-system has parity on
 * iteration budget.
 */
export const DEFAULT_MAX_ATTEMPTS = 10;
/** Default LUFS tolerance per design decision. */
export const DEFAULT_TOLERANCE = 0.5;

/** Single attempt's recorded state. */
export interface IterationAttempt {
	boost: number;
	/**
	 * Constant across attempts within a single `iterateForTargets` call
	 * — `limitDb` is set once from the auto-derivation table at
	 * iteration entry. Kept on each attempt record for diagnostic
	 * continuity with the iteration-end log line.
	 */
	limitDb: number;
	lufsErr: number;
	/**
	 * Observed integrated LUFS-range (LU) of THIS attempt's transformed
	 * output. Diagnostic only — LRA is no longer a target axis (post
	 * `plan-loudness-target-percentile-limit`); it falls out of the
	 * (B, limitDb, peakGainDb) geometry. Surfaced for the
	 * `index.ts._process` iteration-end log line.
	 */
	outputLra: number;
	/**
	 * `currentPeakGainDb` value used for THIS attempt's curve (the
	 * upper-segment right-endpoint anchor gain). Adjusted per attempt
	 * via proportional feedback on observed `outputTruePeakDb`
	 * overshoot. Since `limitDb` is constant across attempts the
	 * closed-form baseline `effectiveTargetTp − limitDb` never changes;
	 * only the feedback adjustment moves.
	 */
	peakGainDb: number;
	/**
	 * Signed peak error in dB measured AFTER this attempt's smoothing
	 * pass: `outputTruePeakDb - effectiveTargetTp`. Negative means
	 * output sat below the ceiling (undershoot, fine); positive means
	 * overshoot.
	 */
	peakErr: number;
	/**
	 * One-sided peak overshoot in dB measured AFTER this attempt's
	 * smoothing pass: `max(0, peakErr)`. `0` when output sat at or
	 * below the ceiling. Drives both the next-attempt proportional-
	 * feedback adjustment of `currentPeakGainDb` and the peak component
	 * of the best-attempt score.
	 */
	peakOvershoot: number;
}

/**
 * Result of {@link iterateForTargets}. Carries the **winning smoothed
 * envelope** so the apply pass can multiply it onto the source without
 * re-running the envelope build — saves one full envelope construction
 * after iteration.
 */
export interface IterateResult {
	/**
	 * 4× upsampled smoothed gain envelope (size `frames *
	 * OVERSAMPLE_FACTOR`). Consumed by `_unbuffer`'s
	 * `applyOversampledChunk` call — the helper does the
	 * source-rate-`offset`-to-upsampled-index mapping internally.
	 */
	bestSmoothedEnvelope: Float32Array;
	bestB: number;
	/**
	 * The (constant) limit anchor `limitDb` used by every attempt.
	 * Kept as a result field for diagnostic continuity with the
	 * iteration-end log line (per `plan-loudness-target-percentile-
	 * limit` §"Open question O3").
	 */
	bestLimitDb: number;
	/**
	 * `currentPeakGainDb` from the winning attempt (the one that
	 * produced `bestSmoothedEnvelope`). Closed-form initial value
	 * `effectiveTargetTp − bestLimitDb` when no peak backoff was
	 * needed; lower when proportional feedback shifted it downward.
	 */
	bestPeakGainDb: number;
	attempts: ReadonlyArray<IterationAttempt>;
	converged: boolean;
}

export interface IterateForTargetsArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	/**
	 * The `floorDb` / `pivotDb` portion of the curve anchors. Constant
	 * across attempts.
	 */
	anchorBase: { floorDb: number | null; pivotDb: number };
	smoothingMs: number;
	targetLufs: number;
	/** Undefined → `effectiveTargetTp = sourcePeakDb` (peaks track body lift unchanged). */
	targetTp: number | undefined;
	/**
	 * Optional explicit override for the limit anchor `limitDb`. When
	 * set, `currentLimit` initialises to this value (clamped to
	 * `[pivotDb + LIMIT_EPSILON_DB, sourcePeakDb]`) instead of the
	 * percentile-derived `limitAutoDb`. Constant across attempts in
	 * either case.
	 */
	limitDbOverride?: number | undefined;
	/**
	 * Percentile-derived limit threshold from `measureSource`'s top-down
	 * walk over the 4×-rate detection-envelope histogram restricted to
	 * `[pivotAutoDb, sourcePeakDb]`. `+Infinity` sentinel when the
	 * source distribution is degenerate (silent / no post-pivot
	 * samples). When `limitDbOverride` is undefined AND `limitAutoDb`
	 * is finite, the iterator uses this as `currentLimit` (clamped);
	 * otherwise falls back to `sourcePeakDb` (no limiting).
	 */
	limitAutoDb: number;
	sourceLufs: number;
	sourcePeakDb: number;
	maxAttempts?: number;
	tolerance?: number;
	/**
	 * One-sided iteration exit threshold for output true-peak overshoot
	 * (dBTP; ceiling — undershoot ignored). Required at this interface;
	 * the schema default on the node ensures callers can omit it. Drives
	 * the proportional-feedback adjustment of `currentPeakGainDb` per
	 * attempt and the peak component of the convergence check.
	 */
	peakTolerance: number;
}

/**
 * Run the 1D secant iteration on `B` until `|lufsErr| < tolerance` and
 * `peakOvershoot <= peakTolerance`, or `maxAttempts` is exhausted.
 * Returns the best attempt's smoothed envelope (held by reference for
 * the apply pass), its `(B, limitDb, peakGainDb)`, and the attempt
 * history.
 */
export async function iterateForTargets(args: IterateForTargetsArgs): Promise<IterateResult> {
	const {
		buffer,
		sampleRate,
		anchorBase,
		smoothingMs,
		targetLufs,
		targetTp,
		limitDbOverride,
		limitAutoDb,
		sourceLufs,
		sourcePeakDb,
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		tolerance = DEFAULT_TOLERANCE,
		peakTolerance,
	} = args;

	const channelCount = buffer.channels;
	const frames = buffer.frames;

	if (channelCount === 0 || frames === 0) {
		return {
			bestSmoothedEnvelope: new Float32Array(0),
			bestB: 0,
			bestLimitDb: sourcePeakDb,
			bestPeakGainDb: 0,
			attempts: [],
			converged: false,
		};
	}

	// `effectiveTargetTp` collapses the `targetTp` default into a single
	// usable ceiling — when the caller omits `targetTp` the ceiling is
	// the source's measured peak, i.e. "peaks track body lift unchanged"
	// per design-loudness-target §"Three target axes".
	const effectiveTargetTp = targetTp ?? sourcePeakDb;
	// `currentLimit` is set ONCE at iteration entry and is constant
	// across attempts. Auto-derivation table:
	//   - explicit override         → use it (clamped)
	//   - else limitAutoDb finite   → use it (clamped) — percentile-
	//     derived per `plan-loudness-target-percentile-limit`
	//   - else                      → sourcePeakDb (no limiting)
	// The `sourcePeakDb` fallback keeps the brick-wall branch dormant
	// for every sample, which is structurally equivalent to "no limit".
	let currentLimit: number;

	if (limitDbOverride !== undefined) {
		currentLimit = clampLimit(limitDbOverride, anchorBase.pivotDb, sourcePeakDb);
	} else if (Number.isFinite(limitAutoDb)) {
		currentLimit = clampLimit(limitAutoDb, anchorBase.pivotDb, sourcePeakDb);
	} else {
		currentLimit = sourcePeakDb;
	}

	// `currentPeakGainDb` starts at the closed-form value relative to
	// the constant `currentLimit` and is mutated downward across
	// attempts when proportional feedback detects overshoot exceeding
	// `peakTolerance`. Since `currentLimit` does not change, the
	// closed-form baseline is computed once here.
	let currentPeakGainDb = effectiveTargetTp - currentLimit;
	// Phase 4: detection, max-pool, curve, and IIR all run at 4× rate.
	// `halfWidth` is in upsampled samples; `iir` is constructed at the
	// upsampled rate so its alpha matches the upsampled signal's
	// bandwidth.
	const upsampledRate = sampleRate * OVERSAMPLE_FACTOR;
	const halfWidth = windowSamplesFromMs(smoothingMs, upsampledRate);
	const iir = new BidirectionalIir({ smoothingMs, sampleRate: upsampledRate });
	// Allocated ONCE outside the attempt loop and overwritten each
	// attempt. Holds the per-attempt forward-IIR output during walk A
	// at 4× rate; after walk B's in-place backward pass `forwardScratch`
	// IS the 4×-rate smoothed gain envelope.
	const forwardScratch = new Float32Array(frames * OVERSAMPLE_FACTOR);
	// Skip the peak axis when the caller did not request peak control
	// (`targetTp` undefined). In that mode `peakGainDb` stays at the
	// closed-form `0`, `peakOvershoot` is forced out of the
	// best-attempt score, and `peakConverged` is forced true.
	const skipPeak = targetTp === undefined;

	let currentBoost = clampBoost(targetLufs - sourceLufs);

	const attempts: Array<IterationAttempt> = [];
	let bestSmoothedEnvelope: Float32Array = new Float32Array(0);
	let bestBoost = currentBoost;
	let bestPeakGainDb = currentPeakGainDb;
	let bestScore = Infinity;
	let previousStepMagnitude = Infinity;

	for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
		const anchors: Anchors = {
			floorDb: anchorBase.floorDb,
			pivotDb: anchorBase.pivotDb,
			limitDb: currentLimit,
			B: currentBoost,
			peakGainDb: currentPeakGainDb,
		};

		// Walk A — fused streaming 4×-upsampled detect + max-pool + curve
		// + forward IIR. Writes into `forwardScratch` (size `frames *
		// OVERSAMPLE_FACTOR`); on exit `forwardScratch` holds the
		// forward-IIR output at 4× rate, ready for the in-place backward
		// pass.
		await streamDetectionMaxPoolAndCurveAndForwardIir({
			buffer,
			channelCount,
			frames,
			sampleRate,
			halfWidth,
			anchors,
			iir,
			forwardScratch,
		});

		// Walk B sub-pass B1 — backward IIR in place over forwardScratch
		// at 4× rate. After this call `forwardScratch` IS the 4×-rate
		// smoothed gain envelope.
		iir.applyBackwardPassInPlace(forwardScratch);

		// Walk B sub-pass B2 — source-streaming apply + LUFS / LRA / TP
		// measurement at 4× rate. Allocates a FRESH per-channel
		// `Oversampler` array for the apply pass.
		const measured = await measureAttemptOutput({
			buffer,
			sampleRate,
			channelCount,
			gSmoothed: forwardScratch,
		});

		const lufsErr = measured.outputLufs - targetLufs;
		// Peak is a one-sided constraint (ceiling, not target) — undershoot
		// is fine, only overshoot drives backoff.
		const peakErr = measured.outputTruePeakDb - effectiveTargetTp;
		// In skip-peak mode `peakOvershoot` is forced to 0 so it does
		// not contribute to `bestScore`, does not gate `peakConverged`,
		// and does not trigger the proportional-feedback adjustment.
		const peakOvershoot = skipPeak ? 0 : Math.max(0, peakErr);

		attempts.push({
			boost: currentBoost,
			limitDb: currentLimit,
			lufsErr,
			outputLra: measured.outputLra,
			peakGainDb: currentPeakGainDb,
			peakErr,
			peakOvershoot,
		});

		// `bestScore` penalises peak overshoot symmetrically with LUFS
		// error; undershoot contributes 0 since `peakOvershoot` is
		// clamped at 0. On infeasible targets this picks the attempt
		// closest to satisfying both constraints.
		const score = Math.sqrt(lufsErr * lufsErr + peakOvershoot * peakOvershoot);

		if (score < bestScore) {
			bestScore = score;
			bestBoost = currentBoost;
			bestPeakGainDb = currentPeakGainDb;
			// Defensive copy: `forwardScratch` is reused across attempts,
			// so the winner needs its own buffer to survive the next
			// attempt's walk-A overwrite. Losing attempts skip this copy.
			bestSmoothedEnvelope = new Float32Array(forwardScratch);
		}

		const lufsConverged = Math.abs(lufsErr) < tolerance;
		const peakConverged = skipPeak || peakOvershoot <= peakTolerance;

		if (lufsConverged && peakConverged) {
			return {
				bestSmoothedEnvelope,
				bestB: bestBoost,
				bestLimitDb: currentLimit,
				bestPeakGainDb,
				attempts,
				converged: true,
			};
		}

		if (attemptIndex === maxAttempts - 1) break;

		// Proportional feedback on `currentPeakGainDb` — adjusts the
		// upper-segment right-endpoint anchor BEFORE the next attempt's
		// curve evaluation. Only fires on overshoot exceeding the
		// one-sided tolerance; undershoot leaves the value untouched.
		// `Math.max(PEAK_GAIN_DB_FLOOR, ...)` caps cumulative
		// attenuation. The `B`-secant does NOT see this update through
		// its history — proportional feedback only.
		if (peakOvershoot > peakTolerance) {
			currentPeakGainDb = Math.max(
				PEAK_GAIN_DB_FLOOR,
				currentPeakGainDb - peakOvershoot * PEAK_DAMPING,
			);
		}

		const next = computeBoostStep(attempts, previousStepMagnitude);

		currentBoost = clampBoost(next.boost);
		previousStepMagnitude = next.stepMagnitude;
	}

	return {
		bestSmoothedEnvelope,
		bestB: bestBoost,
		bestLimitDb: currentLimit,
		bestPeakGainDb,
		attempts,
		converged: false,
	};
}

interface StreamDetectionMaxPoolAndCurveAndForwardIirArgs {
	buffer: ChunkBuffer;
	channelCount: number;
	frames: number;
	sampleRate: number;
	halfWidth: number;
	anchors: Anchors;
	iir: BidirectionalIir;
	forwardScratch: Float32Array;
}

/**
 * Walk A of the per-attempt body, post-Phase-4 (4×-upsampled). Streams
 * the source via `buffer.iterate(CHUNK_FRAMES)`; per chunk: upsample,
 * 4×-rate linked detection, sliding max-pool, gain curve, forward IIR.
 * Output is written into `forwardScratch` at the correct absolute
 * upsampled offset.
 *
 * Output is deferred by `halfWidth` (in upsampled samples) on the
 * leading edge; tracks `consumedUpsampledFrames` and `outputOffset`
 * (both in upsampled samples) and signals `isFinal === true` on the
 * chunk that closes out the source so the trailing-edge outputs flush.
 *
 * `forwardScratch` must be sized `frames * OVERSAMPLE_FACTOR`; the
 * function fills exactly those slots once Walk A completes.
 */
async function streamDetectionMaxPoolAndCurveAndForwardIir(
	args: StreamDetectionMaxPoolAndCurveAndForwardIirArgs,
): Promise<void> {
	const { buffer, channelCount, frames, sampleRate, halfWidth, anchors, iir, forwardScratch } = args;

	if (frames === 0 || channelCount === 0) return;

	// Fresh per-channel oversamplers for THIS walk only. Biquad state
	// continues across chunks of THIS walk; the array is dropped at
	// walk end. MUST NOT be shared with walk B's apply oversamplers or
	// the stream class's persistent apply set — those have absorbed
	// different signal histories.
	const detectionOversamplers: Array<Oversampler> = [];

	for (let channelIdx = 0; channelIdx < channelCount; channelIdx++) {
		detectionOversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
	}

	const upsampledTotal = frames * OVERSAMPLE_FACTOR;
	const slidingWindow = new SlidingWindowMaxStream(halfWidth);
	const forwardState = { value: 0 };
	let forwardSeeded = false;
	let consumedUpsampledFrames = 0;
	let outputOffset = 0;

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const channels = chunk.samples;
		const chunkFrames = channels[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		// Upsample each channel to 4×.
		const upChannels: Array<Float32Array> = [];

		for (let channelIdx = 0; channelIdx < channels.length; channelIdx++) {
			const channel = channels[channelIdx];
			const oversampler = detectionOversamplers[channelIdx];

			if (channel === undefined || oversampler === undefined) {
				upChannels.push(new Float32Array(chunkFrames * OVERSAMPLE_FACTOR));
				continue;
			}

			upChannels.push(oversampler.upsample(channel));
		}

		const upChunkLength = chunkFrames * OVERSAMPLE_FACTOR;
		// 4×-rate detection per chunk: `max_c |upChannels[c][upIdx]|`
		// per upsampled sample.
		const detectChunk = new Float32Array(upChunkLength);

		for (let upIdx = 0; upIdx < upChunkLength; upIdx++) {
			let max = 0;

			for (let channelIdx = 0; channelIdx < upChannels.length; channelIdx++) {
				const upSample = upChannels[channelIdx]?.[upIdx] ?? 0;
				const absolute = Math.abs(upSample);

				if (absolute > max) max = absolute;
			}

			detectChunk[upIdx] = max;
		}

		consumedUpsampledFrames += upChunkLength;

		// Max-pool per chunk via the streaming form.
		const isFinal = consumedUpsampledFrames >= upsampledTotal;
		const windowChunk = slidingWindow.push(detectChunk, isFinal);

		if (windowChunk.length === 0) continue;

		// Curve per output sample at 4× rate: `g[k] = 10^(gainDbAt(
		// linearToDb(window[k])) / 20)`.
		const gWindowChunk = new Float32Array(windowChunk.length);

		for (let outputIdx = 0; outputIdx < windowChunk.length; outputIdx++) {
			const levelDb = linearToDb(windowChunk[outputIdx] ?? 0);
			const gainDb = gainDbAt(levelDb, anchors);

			gWindowChunk[outputIdx] = Math.pow(10, gainDb / 20);
		}

		// Forward IIR (at upsampled rate, alpha already correct) with
		// state continuity across chunks. Seed from the first emitted
		// curve sample.
		if (!forwardSeeded) {
			forwardState.value = gWindowChunk[0] ?? 0;
			forwardSeeded = true;
		}

		const forwardChunk = iir.applyForwardPass(gWindowChunk, forwardState);

		forwardScratch.set(forwardChunk, outputOffset);
		outputOffset += forwardChunk.length;
	}
}

interface MeasureAttemptArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	channelCount: number;
	gSmoothed: Float32Array;
}

interface MeasureAttemptResult {
	readonly outputLufs: number;
	readonly outputLra: number;
	/**
	 * 4× upsampled true peak in dBTP of the transformed output of THIS
	 * attempt. Measured in lockstep with the `LoudnessAccumulator` via
	 * a parallel {@link TruePeakAccumulator} over the same transformed
	 * chunks. `-Infinity` for silent output.
	 */
	readonly outputTruePeakDb: number;
}

/**
 * Per-attempt body (walk B sub-pass B2): stream the source through
 * `applyOversampledChunk` (4×-rate apply via fresh per-channel
 * `Oversampler` array) and parallel `LoudnessAccumulator` /
 * `TruePeakAccumulator`. Returns integrated LUFS, LRA, and 4× true
 * peak of the transformed signal.
 */
async function measureAttemptOutput(args: MeasureAttemptArgs): Promise<MeasureAttemptResult> {
	const { buffer, sampleRate, channelCount, gSmoothed } = args;
	const accumulator = new LoudnessAccumulator(sampleRate, channelCount);
	const truePeakAccumulator = new TruePeakAccumulator(sampleRate, channelCount);

	// Fresh per-channel apply oversamplers — distinct from walk A's
	// detection set AND from the stream class's persistent apply set.
	const applyOversamplers: Array<Oversampler> = [];

	for (let channelIdx = 0; channelIdx < channelCount; channelIdx++) {
		applyOversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
	}

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const chunkFrames = chunk.samples[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		const transformed = applyOversampledChunk({
			chunkSamples: chunk.samples,
			smoothedGain: gSmoothed,
			offset: chunk.offset,
			oversamplers: applyOversamplers,
			factor: OVERSAMPLE_FACTOR,
		});

		accumulator.push(transformed, chunkFrames);
		truePeakAccumulator.push(transformed, chunkFrames);
	}

	const result = accumulator.finalize();
	const truePeakLinear = truePeakAccumulator.finalize();
	const outputTruePeakDb = linearToDb(truePeakLinear);

	return { outputLufs: result.integrated, outputLra: result.range, outputTruePeakDb };
}

interface BoostStep {
	boost: number;
	stepMagnitude: number;
}

/**
 * 1D secant on `B` for LUFS error. Branches by history length:
 *   - exactly 1 point: full RMS-shift correction `B_next = B - lufsErr`.
 *   - ≥ 2 points: classical secant on the most recent two attempts,
 *     with `MIN_SECANT_SLOPE` floor on the slope magnitude and
 *     half-previous-step damping.
 */
function computeBoostStep(attempts: ReadonlyArray<IterationAttempt>, previousStepMagnitude: number): BoostStep {
	const last = attempts[attempts.length - 1];

	if (last === undefined) return { boost: 0, stepMagnitude: Infinity };

	if (attempts.length === 1) {
		const stepBoost = -last.lufsErr;

		return { boost: last.boost + stepBoost, stepMagnitude: Math.abs(stepBoost) };
	}

	const previous = attempts[attempts.length - 2];

	if (previous === undefined) return { boost: last.boost, stepMagnitude: 0 };

	const deltaBoost = last.boost - previous.boost;
	const deltaLufs = last.lufsErr - previous.lufsErr;
	let slope = deltaBoost === 0 ? 0 : deltaLufs / deltaBoost;

	if (!Number.isFinite(slope) || Math.abs(slope) < MIN_SECANT_SLOPE) {
		const sign = slope < 0 ? -1 : 1;

		slope = sign * MIN_SECANT_SLOPE;
	}

	const stepBoostRaw = -last.lufsErr / slope;
	const magnitudeCap = Number.isFinite(previousStepMagnitude) ? previousStepMagnitude * 0.5 : Infinity;
	const absStep = Math.abs(stepBoostRaw);
	const scale = absStep > magnitudeCap && absStep > 0 ? magnitudeCap / absStep : 1;
	const stepBoost = stepBoostRaw * scale;

	return { boost: last.boost + stepBoost, stepMagnitude: Math.abs(stepBoost) };
}

function clampBoost(boost: number): number {
	if (!Number.isFinite(boost)) return 0;
	if (boost < BOOST_LOWER_BOUND) return BOOST_LOWER_BOUND;
	if (boost > BOOST_UPPER_BOUND) return BOOST_UPPER_BOUND;

	return boost;
}

/**
 * Clamp `limitDb` to the per-source feasible window:
 *   - lower bound: `pivotDb + LIMIT_EPSILON_DB` — the upper-body
 *     segment of the curve divides by `(limitDb − pivotDb)`, so equal
 *     values would divide by zero (see `curve.ts:gainDbAt`).
 *   - upper bound: `sourcePeakDb` — no samples to limit above the
 *     source's measured peak. Beyond it the brick-wall branch is
 *     dormant for every sample, which is structurally equivalent to
 *     `limitDb = sourcePeakDb` exactly.
 *
 * Degenerate-window guard: when `pivotDb + LIMIT_EPSILON_DB >
 * sourcePeakDb` the feasible window is empty. Returns `sourcePeakDb`
 * — brick-wall never engages because no sample sits above the peak.
 *
 * Non-finite inputs collapse to `sourcePeakDb` (the "no limiting"
 * fallback) — matches the iterator's initial-value semantics when
 * the auto-derived value is `+Infinity`.
 */
function clampLimit(limitDb: number, pivotDb: number, sourcePeakDb: number): number {
	if (!Number.isFinite(limitDb)) return sourcePeakDb;

	const lower = pivotDb + LIMIT_EPSILON_DB;

	if (lower > sourcePeakDb) return sourcePeakDb;
	if (limitDb < lower) return lower;
	if (limitDb > sourcePeakDb) return sourcePeakDb;

	return limitDb;
}
