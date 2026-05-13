/**
 * Joint two-axis iteration for the loudnessTarget node — every attempt
 * updates BOTH `B` (body gain) and `peakGainDb` (upper-segment anchor)
 * based on the previous attempt's (lufsErr, peakErr). Replaces the
 * earlier sequential Phase A → Phase B structure (see the 2026-05-13
 * decision in `design-loudness-target.md`).
 *
 * Per design-transforms §"Memory discipline": the source itself is
 * streamed via `buffer.read(CHUNK_FRAMES)` loop until short chunk; never
 * materialised as a full-source-sized Float32Array at this level.
 *
 * Two perceptual targets — `targetLufs` and `targetTp` — converge
 * jointly on two curve parameters, `(B, peakGainDb)`. The limit
 * anchor `limitDb` is set ONCE at iteration entry from the
 * auto-derivation table:
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
 * ## Joint per-attempt update
 *
 * Both axes move every attempt. The two per-axis update rules:
 *
 * - **`B` via 1D secant on LUFS error**. On attempt 1 with one history
 *   point, the first probe applies the RMS-shift correction `B - lufsErr`
 *   to seed the secant. On attempt ≥ 2, classical 1D secant on the most
 *   recent two attempts (slope `dLUFS/dB`, minimum magnitude
 *   `MIN_SECANT_SLOPE` to avoid degenerate steps). Step-magnitude
 *   damping is **asymmetric** (preserved from the sequential design's
 *   2026-05-11 decision): same-sign consecutive errors → no cap, trust
 *   the secant; sign-flipped consecutive errors → cap at 1× previous
 *   step magnitude (no-revert-past-known-bad rule). `B` clamped to
 *   `[-30, 30]` dB.
 *
 * - **`peakGainDb` via proportional feedback on signed peakErr**
 *   (`peakErr = outputTruePeakDb - effectiveTargetTp`). On any attempt
 *   where `|peakErr| > peakTolerance`, the next attempt's
 *   `currentPeakGainDb` is shifted by `-peakErr * PEAK_DAMPING`:
 *     - `peakErr > 0` (output above target) → decrease `peakGainDb`
 *       (pull peaks down).
 *     - `peakErr < 0` (output below target) → increase `peakGainDb`
 *       (push peaks up). Symmetric: undershoot is corrected the same
 *       way overshoot is. Replaces the earlier one-sided `peakOvershoot
 *       = max(0, peakErr)` formulation, which left TP undershoots
 *       uncorrected (the iterator reported convergence even when output
 *       sat well below the ceiling).
 *   Bounded below by `PEAK_GAIN_DB_FLOOR`; no upper bound because
 *   `peakGainDb` can validly exceed `B` (expansive upper segment) when
 *   the source's peak headroom permits.
 *
 * ## Why joint (vs the prior sequential design)
 *
 * The sequential Phase A → Phase B design assumed stationary curve
 * geometry within each phase: A moved `peakGainDb` with `B` held; B
 * moved `B` with `peakGainDb` frozen at A's terminal value. Empirical
 * findings from a full-render QA (Pretrained ep 060 Pierce chain)
 * showed Phase B's large body-gain moves coupling to TP through the
 * smoothed envelope below `limitDb` — final output landed +2.25 dBTP
 * over target despite Phase A having converged inside `peakTolerance`.
 * Sequential assumed the coupling was weak; for EXPANSIVE_UPPER_SEGMENT
 * curves (`peakGainDb > B`) it isn't.
 *
 * Joint iteration breaks the stationarity assumption deliberately: each
 * attempt's measurement reflects the joint effect of both axes, and the
 * next attempt's per-axis updates use that joint signal. This is
 * coordinate descent in 2D — converges when the coupling is mild and
 * lets both axes correct in lockstep when it isn't.
 *
 * **Slope-contamination hazard** (the bug sequential existed to fix):
 * the B-secant's slope estimate spans attempts where `peakGainDb` is
 * also moving, so the slope reflects motion on a non-stationary
 * function. Mitigation: the asymmetric damping (sign-flip → 1× cap)
 * prevents the contaminated slope from runaway overshoot — same-sign
 * descent self-validates the secant's local prediction, and sign-flips
 * engage the cap. Empirically this holds on EXPANSIVE_UPPER_SEGMENT
 * curves where coupling is strongest; documented as the trade-off for
 * single-loop convergence on coupled axes.
 *
 * ## Symmetric peak error (formerly one-sided overshoot)
 *
 * `peakErr = outputTruePeakDb - effectiveTargetTp` is **signed**. The
 * convergence gate is `|peakErr| < peakTolerance` (two-sided). The
 * best-attempt score is `sqrt(lufsErr² + peakErr²)` (both axes
 * two-sided). The earlier code computed `peakOvershoot = max(0, peakErr)`
 * which left undershoots invisible to the convergence gate and to the
 * score — an attempt with output sitting 0.5 dBTP below target reported
 * `converged = true` and scored 0 on the peak axis even though peaks
 * landed well outside Matt's editorial tolerance. The signed
 * formulation makes both directions equally penalising.
 *
 * ## Convergence gates (checked in order each attempt)
 *
 *   1. **Two-decimal-precision gate (always active)**: fires when
 *      `round(|lufsErr| × 100) === 0` AND
 *      `skipPeak || round(|peakErr| × 100) === 0`. This is the
 *      "perfect to the user-visible precision" exit — the
 *      iteration-end log line reports `outputLufs` / `outputTruePeakDb`
 *      to two decimal places, so once both axes round to their
 *      targets at that precision additional attempts cannot improve
 *      the reported result. Unconditional — does NOT consult
 *      `tolerance` / `peakTolerance`. Now uses `|peakErr|` instead of
 *      one-sided `peakOvershoot`.
 *   2. **Tolerance-based gate**: fires when `|lufsErr| < tolerance`
 *      AND `skipPeak || |peakErr| < peakTolerance`. Skipped silently
 *      when `tolerance` / `peakTolerance` are undefined (per the
 *      "undefined ⇒ run to budget" contract on the BAG schema).
 *
 * ## Pipeline per attempt
 *
 *   1. Build anchors `{ floorDb, pivotDb, limitDb, B, peakGainDb }`.
 *   2. **Walk A** — curve + forward IIR over the pre-built 4×-rate
 *      detection envelope cache. Writes into `forwardEnvelopeBuffer`.
 *   3. **Walk B sub-pass B1** — backward IIR over `forwardEnvelopeBuffer`
 *      into `activeRef` (the per-attempt smoothed envelope destination).
 *   4. **Walk B sub-pass B2** — apply (multiply by `activeRef`) +
 *      measure (LUFS / LRA / true peak) over the upsampled source cache.
 *   5. Record `(B, peakGainDb, lufsErr, peakErr, outputLra)`. On
 *      best-attempt update, swap `activeRef` / `winningRef` (pointer-
 *      level, no envelope copy). Otherwise clear `activeRef` for the
 *      next attempt.
 *
 * ## Best-attempt fallback
 *
 * Track the attempt with the smallest `sqrt(lufsErr² + peakErr²)` (both
 * signed; equal weighting between axes). On `maxAttempts` exhaustion or
 * joint infeasibility, return that attempt's smoothed envelope plus its
 * `(B, peakGainDb)` and `converged = false`. The buffer-swap mechanic
 * guarantees the held `winningRef` envelope matches the reported
 * `(bestB, bestPeakGainDb)` — both are updated together inside the same
 * `score < bestScore` branch. This fixes the discrepancy in the prior
 * sequential design where the `bestB` could be set from a different
 * attempt than the one whose envelope was held.
 *
 * No axis weighting in the score: equal cost on `lufsErr` and `peakErr`
 * is the point of joint iteration — single-measurement priority is what
 * sequential Phase A → Phase B was, and it produced the failure mode
 * that motivated the rewrite. On infeasible joint targets the fallback
 * returns the locally-balanced attempt; the convergence gates remain
 * `|lufsErr| < tolerance AND |peakErr| < peakTolerance` (both required).
 *
 * `bestLimitDb` on `IterateResult` is a constant value (same across
 * all attempts) — kept for diagnostic continuity with the iteration-end
 * log line.
 */

import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { BidirectionalIir, LoudnessAccumulator, Oversampler, TruePeakAccumulator, linearToDb } from "@e9g/buffered-audio-nodes-utils";
import { applyOversampledChunkFromCache } from "./apply";
import { type Anchors, gainDbAt } from "./curve";
import { applyBackwardPassOverChunkBuffer, windowSamplesFromMs } from "./envelope";
import { buildSourceUpsampledAndDetectionCaches } from "./source-caches";

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
 * adjustment (symmetric joint iteration). Each attempt, after measuring
 * `outputTruePeakDb`, if `|peakErr| > peakTolerance`, the next
 * attempt's `currentPeakGainDb` is shifted by `-peakErr * PEAK_DAMPING`
 * (negative-signed correction: overshoot pulls down, undershoot pulls
 * up). Damping `< 1` avoids oscillation against the `B`-secant — both
 * axes push the upper-segment slope, so a full-correction step on
 * `peakGainDb` would overshoot in the opposite direction once `B`
 * recompensates. `0.8` is the chosen starting value per Open Question
 * O1 in `plan-loudness-target-tp-iteration` (preserved through both
 * the prior sequential design and the 2026-05-13 joint rewrite).
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
	 * via proportional feedback on observed signed `peakErr`. Since
	 * `limitDb` is constant across attempts, the closed-form baseline
	 * `effectiveTargetTp − limitDb` never changes; only the feedback
	 * adjustment moves.
	 */
	peakGainDb: number;
	/**
	 * Signed peak error in dB measured AFTER this attempt's smoothing
	 * pass: `outputTruePeakDb - effectiveTargetTp`. Negative means
	 * output sat below the ceiling (undershoot — now corrected
	 * symmetrically by pulling `peakGainDb` UP); positive means
	 * overshoot (corrected by pulling `peakGainDb` DOWN). Both axes
	 * of the joint update + convergence gate operate on this signed
	 * value.
	 */
	peakErr: number;
}

/**
 * Result of {@link iterateForTargets}. Carries the **winning smoothed
 * envelope** so the apply pass can multiply it onto the source without
 * re-running the envelope build — saves one full envelope construction
 * after iteration.
 */
export interface IterateResult {
	/**
	 * 4× upsampled smoothed gain envelope as a single-channel
	 * `ChunkBuffer` (size `frames * OVERSAMPLE_FACTOR`). Per
	 * Phase 3 of `plan-loudness-target-stream-caching`, the envelope
	 * is disk-backed rather than a flat `Float32Array` — `_unbuffer`
	 * reads chunk-aligned slices via `read(N)` sequential and feeds
	 * them to `applyOversampledChunkFromCache`. The buffer's RAM
	 * footprint stays at ~10 MB (per `ChunkBuffer`'s lazy 10 MB
	 * scratch threshold) regardless of source length.
	 *
	 * Lifetime: extends beyond `iterateForTargets`. The stream class
	 * stores this in its persistent state; `_unbuffer` reads from it
	 * chunk-by-chunk; teardown closes it.
	 */
	bestSmoothedEnvelopeBuffer: ChunkBuffer;
	/**
	 * 4×-upsampled per-channel source cache built ONCE at iteration
	 * entry and shared across every per-attempt Walk B (apply +
	 * measure) AND `_unbuffer`'s final apply pass. Per Phase 2 of
	 * `plan-loudness-target-stream-caching`, this eliminates the
	 * per-attempt upsample pass — across N attempts, savings are
	 * `(N − 1) × channelCount` upsamples per attempt loop.
	 *
	 * Lifetime: extends beyond `iterateForTargets`. The stream class
	 * (`LoudnessTargetStream._process`) stores this in its persistent
	 * state; `_unbuffer` reads from it chunk-by-chunk; the stream's
	 * teardown closes it. Caller is responsible for `close()` after
	 * the final `_unbuffer` chunk emits.
	 *
	 * `null` when iteration short-circuited on a zero-frame / zero-
	 * channel source (no cache was built).
	 */
	upsampledSource: ChunkBuffer | null;
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
 * Run the joint two-axis iteration. Every attempt updates BOTH `B`
 * (via 1D secant on signed `lufsErr`) and `peakGainDb` (via
 * proportional feedback on signed `peakErr`). Total attempt budget is
 * `maxAttempts`. Convergence requires `|lufsErr| < tolerance` AND
 * (`skipPeak` OR `|peakErr| < peakTolerance`) — both axes two-sided.
 * On budget exhaustion returns the best attempt by
 * `sqrt(lufsErr² + peakErr²)`; the buffer-swap mechanic guarantees
 * the held smoothed envelope matches the reported
 * `(bestB, bestPeakGainDb)`.
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
		// Pass-through bail: build a zero-frame envelope buffer so the
		// return shape stays consistent with the normal-path returns.
		// `_unbuffer` checks `winningSmoothedEnvelopeBuffer.frames` (or
		// short-circuits on the null `upsampledSource`) before reading.
		return {
			bestSmoothedEnvelopeBuffer: new ChunkBuffer(),
			upsampledSource: null,
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

	// Build the per-source caches ONCE at iteration entry. Both are
	// pure functions of the source (post-upsample) and do not depend on
	// any per-attempt parameter. Walk A reads `caches.detectionEnvelope`;
	// Walk B (via `measureAttemptOutput`) and `_unbuffer` read
	// `caches.upsampledSource` (Phase 2.3 / 2.4 of `plan-loudness-target-
	// stream-caching`). The detection-envelope cache has no consumer
	// outside this function, so it is closed in the `finally` below.
	// The upsampled-source cache outlives this function — it is
	// returned via `IterateResult.upsampledSource` and the stream
	// class is responsible for closing it after `_unbuffer` drains.
	const caches = await buildSourceUpsampledAndDetectionCaches({
		buffer,
		sampleRate,
		channelCount,
		frames,
		halfWidth,
	});

	// Three single-channel disk-backed envelope buffers per Phase 3 of
	// `plan-loudness-target-stream-caching`:
	//   - `forwardEnvelopeBuffer`: Walk A writes forward-IIR output;
	//     clear() at the end of each attempt.
	//   - `activeRef` / `winningRef` (initially `activeBufferA` /
	//     `activeBufferB`): the active dest for this attempt's
	//     backward pass, and the held winner from the best attempt so
	//     far. On a best-attempt update we swap the refs (pointer-
	//     level swap, no copy — the whole point of the ping-pong is
	//     to avoid frames×4×4-byte copies on every winner update).
	const forwardEnvelopeBuffer = new ChunkBuffer();
	const activeBufferA = new ChunkBuffer();
	const activeBufferB = new ChunkBuffer();

	let activeRef: ChunkBuffer = activeBufferA;
	let winningRef: ChunkBuffer = activeBufferB;
	let winningPopulated = false;

	try {
		// Skip the peak axis when the caller did not request peak control
		// (`targetTp` undefined). In that mode `peakGainDb` stays at the
		// closed-form `0`, the peak component of `bestScore` is forced
		// to 0, and the peak axis of both convergence gates is force-
		// satisfied. The `peakGainDb` update branch is also skipped.
		const skipPeak = targetTp === undefined;

		let currentBoost = clampBoost(targetLufs - sourceLufs);

		const attempts: Array<IterationAttempt> = [];
		let bestBoost = currentBoost;
		let bestPeakGainDb = currentPeakGainDb;
		let bestScore = Infinity;

		// Tracked across attempts for the asymmetric-damping rule in
		// `computeBoostStep`. Starts at `Infinity` so the very first
		// per-secant call (attempt ≥ 2) does not cap the predicted step.
		let previousStepMagnitude = Infinity;

		// =====================================================================
		// Joint iteration — both axes update every attempt.
		//
		// On each attempt:
		//   1. Render the curve with `(currentBoost, currentPeakGainDb)`.
		//   2. Measure (lufsErr, peakErr).
		//   3. Update running best (buffer + (B, peakGainDb) in lockstep).
		//   4. Check convergence gates (precision then tolerance).
		//   5. If not converged and budget remains, update BOTH axes:
		//      - B: 1D secant on lufsErr history (RMS-shift on attempt 1).
		//      - peakGainDb: proportional on signed peakErr (when
		//        |peakErr| > peakTolerance and not skipPeak).
		//
		// The B-secant's history spans all attempts (no phase filter); the
		// slope is fit on a non-stationary function (peakGainDb is also
		// moving), so the slope estimate is "contaminated" in the sense
		// the prior sequential design tried to avoid. The asymmetric
		// damping (sign-flip → 1× cap) bounds the contaminated slope's
		// step. The trade-off: joint single-loop convergence on coupled
		// axes vs the sequential design's stationary-slope guarantee.
		// See the file-level JSDoc for the empirical motivation.
		// =====================================================================

		for (let attemptIdx = 0; attemptIdx < maxAttempts; attemptIdx++) {
			const anchors: Anchors = {
				floorDb: anchorBase.floorDb,
				pivotDb: anchorBase.pivotDb,
				limitDb: currentLimit,
				B: currentBoost,
				peakGainDb: currentPeakGainDb,
			};

			// Walk A — curve + forward IIR over the pre-built 4×-rate
			// detection envelope cache. Writes into `forwardEnvelopeBuffer`
			// chunk-by-chunk.
			await streamCurveAndForwardIir({
				detectionEnvelope: caches.detectionEnvelope,
				anchors,
				iir,
				forwardEnvelopeBuffer,
			});

			// Walk B sub-pass B1 — backward IIR over the forward-envelope
			// ChunkBuffer into the active smoothed-envelope buffer.
			await applyBackwardPassOverChunkBuffer({
				sourceBuffer: forwardEnvelopeBuffer,
				destBuffer: activeRef,
				iir,
				chunkSize: CHUNK_FRAMES * OVERSAMPLE_FACTOR,
			});

			// Walk B sub-pass B2 — source-streaming apply + LUFS / LRA / TP
			// measurement at 4× rate.
			const measured = await measureAttemptOutput({
				upsampledSource: caches.upsampledSource,
				sampleRate,
				channelCount,
				gSmoothed: activeRef,
			});

			const lufsErr = measured.outputLufs - targetLufs;
			// Signed peakErr — undershoot (negative) and overshoot
			// (positive) both contribute to the peak axis of the gate
			// and the best-attempt score. In skip-peak mode the peak
			// signal is suppressed by forcing the score's peak component
			// to 0 below.
			const peakErr = measured.outputTruePeakDb - effectiveTargetTp;

			attempts.push({
				boost: currentBoost,
				limitDb: currentLimit,
				lufsErr,
				outputLra: measured.outputLra,
				peakGainDb: currentPeakGainDb,
				peakErr,
			});

			// Best-attempt score, equal-weighted both axes:
			// `sqrt(lufsErr² + peakErr²)` (both two-sided). In skipPeak
			// mode the peak component is zeroed so only `|lufsErr|` ranks
			// attempts.
			//
			// No priority weighting — joint iteration's whole point is
			// that both axes count equally. Per-axis priority is what the
			// sequential Phase A → Phase B design did, and that's the
			// design that produced the TP overshoot / undershoot failure
			// modes this rewrite targets.
			const peakScoreTerm = skipPeak ? 0 : peakErr * peakErr;
			const score = Math.sqrt(lufsErr * lufsErr + peakScoreTerm);

			if (score < bestScore) {
				bestScore = score;
				bestBoost = currentBoost;
				bestPeakGainDb = currentPeakGainDb;
				// Swap: the just-written `activeRef` becomes the new
				// winner; the held `winningRef` becomes the next
				// attempt's `activeRef`. Both the reported best params
				// and the held envelope are updated inside this branch
				// — they cannot diverge, fixing the prior design's
				// discrepancy where `bestB` could come from a different
				// attempt than the held envelope.
				const previousActive = activeRef;

				activeRef = winningRef;
				winningRef = previousActive;
				winningPopulated = true;
				await activeRef.clear();
			} else {
				// Loss: clear the just-written active buffer now so the
				// next attempt starts on an empty buffer.
				await activeRef.clear();
			}

			// Forward-envelope buffer is transient per-attempt.
			await forwardEnvelopeBuffer.clear();

			// Gate 1 — two-decimal-precision early exit. Always active.
			// Fires when both axes round to zero error at two decimal
			// places (the precision the iteration-end log reports at).
			// Now two-sided on peak: `|peakErr|` replaces the prior
			// one-sided `peakOvershoot`.
			const matchesToTwoDp =
				Math.round(Math.abs(lufsErr) * 100) === 0
				&& (skipPeak || Math.round(Math.abs(peakErr) * 100) === 0);

			if (matchesToTwoDp) {
				return {
					bestSmoothedEnvelopeBuffer: winningRef,
					bestB: bestBoost,
					bestLimitDb: currentLimit,
					bestPeakGainDb,
					attempts,
					upsampledSource: caches.upsampledSource,
					converged: true,
				};
			}

			// Gate 2 — tolerance-based exit. Silently skipped when
			// `tolerance` / `peakTolerance` are undefined (the BAG omits
			// them → "run to budget"). Two-sided on peak.
			const lufsConverged = Math.abs(lufsErr) < tolerance;
			const peakConverged = skipPeak || Math.abs(peakErr) < peakTolerance;

			if (lufsConverged && peakConverged) {
				return {
					bestSmoothedEnvelopeBuffer: winningRef,
					upsampledSource: caches.upsampledSource,
					bestB: bestBoost,
					bestLimitDb: currentLimit,
					bestPeakGainDb,
					attempts,
					converged: true,
				};
			}

			if (attemptIdx === maxAttempts - 1) break;

			// Joint per-axis updates for the next attempt.

			// B-axis update: 1D secant on lufsErr using the full attempt
			// history (no phase filter — sequential's stationary-slope
			// invariant is gone, replaced by asymmetric damping +
			// joint-update robustness). On attempt 1 (one history point)
			// `computeBoostStep` returns the RMS-shift `B - lufsErr`.
			const next = computeBoostStep(attempts, previousStepMagnitude);

			currentBoost = clampBoost(next.boost);
			previousStepMagnitude = next.stepMagnitude;

			// peakGainDb-axis update: proportional feedback on signed
			// peakErr. Skipped in skip-peak mode (the closed-form initial
			// value stays put). Also skipped when the current attempt's
			// peakErr is within tolerance — no update needed and avoids
			// unnecessary churn that could perturb a converged peak.
			if (!skipPeak && Math.abs(peakErr) > peakTolerance) {
				// Signed correction:
				//   peakErr > 0 (overshoot)  → currentPeakGainDb decreases
				//   peakErr < 0 (undershoot) → currentPeakGainDb increases
				// The earlier one-sided rule `currentPeakGainDb -=
				// peakOvershoot * PEAK_DAMPING` left undershoot
				// uncorrected; symmetric proportional feedback closes
				// that gap.
				currentPeakGainDb = Math.max(
					PEAK_GAIN_DB_FLOOR,
					currentPeakGainDb - peakErr * PEAK_DAMPING,
				);
			}
		}

		return {
			bestSmoothedEnvelopeBuffer: winningRef,
			upsampledSource: caches.upsampledSource,
			bestB: bestBoost,
			bestLimitDb: currentLimit,
			bestPeakGainDb,
			attempts,
			converged: false,
		};
	} finally {
		// `detectionEnvelope` has no downstream consumer — close it
		// here on every return path (normal returns above + exception
		// propagation). The `upsampledSource` cache is intentionally
		// NOT closed here: it is returned via `IterateResult` and
		// outlives this function (`_unbuffer` reads from it per chunk).
		await caches.detectionEnvelope.close();
		// `forwardEnvelopeBuffer` is transient — closed unconditionally.
		// The losing one of `activeBufferA` / `activeBufferB` (the one
		// NOT held by `winningRef`) is also closed here. The winning
		// buffer is returned via `IterateResult.bestSmoothedEnvelopeBuffer`
		// and outlives this function.
		await forwardEnvelopeBuffer.close();
		// If no best-attempt update ever fired (impossible for non-zero
		// frames since the first attempt always beats `Infinity`),
		// `winningRef` still equals `activeBufferB` and `activeBufferA`
		// holds the last attempt's output. Close both as a safety net
		// in that pathological branch.
		if (!winningPopulated) {
			await activeBufferA.close();
			await activeBufferB.close();
		} else if (winningRef === activeBufferA) {
			await activeBufferB.close();
		} else {
			await activeBufferA.close();
		}
	}
}

interface StreamCurveAndForwardIirArgs {
	detectionEnvelope: ChunkBuffer;
	anchors: Anchors;
	iir: BidirectionalIir;
	forwardEnvelopeBuffer: ChunkBuffer;
}

/**
 * Walk A of the per-attempt body, post-Phase-3-envelope-chunkbuffer:
 * read the pre-built detection-envelope cache and write the forward-
 * IIR output to a disk-backed `ChunkBuffer` chunk-by-chunk. Per
 * `plan-loudness-target-stream-caching` Phase 3.2.
 *
 * Streams the detection-envelope ChunkBuffer via
 * `detectionEnvelope.read(CHUNK_FRAMES * OVERSAMPLE_FACTOR)` loop until
 * short chunk. The cache is single-channel at 4× rate (the leading-edge
 * defer of `halfWidth` samples was absorbed by the cache builder), so
 * `chunk.samples[0]` carries the already-pooled detection envelope.
 *
 * `forwardEnvelopeBuffer` is written chunk-by-chunk. The caller must
 * `clear()` it before each attempt's walk-A call so this attempt's
 * output replaces (rather than extends) the previous attempt's.
 */
async function streamCurveAndForwardIir(
	args: StreamCurveAndForwardIirArgs,
): Promise<void> {
	const { detectionEnvelope, anchors, iir, forwardEnvelopeBuffer } = args;

	if (detectionEnvelope.frames === 0) return;

	// Rewind detection envelope's read cursor — the cache is re-read
	// from frame 0 each attempt.
	await detectionEnvelope.reset();

	const forwardState = { value: 0 };
	let forwardSeeded = false;

	// Persistent per-chunk scratch for the curve-eval output. Same
	// pattern as Phase 1.1 (`gWindowScratch`): sized at the maximum
	// upsampled chunk length, reused via `.subarray(0, length)`. The
	// cache emits exactly `CHUNK_FRAMES * OVERSAMPLE_FACTOR` samples
	// per chunk (except the last) — no `+ halfWidth` slack is needed
	// here because the sliding-window flush already happened in the
	// cache build.
	const upsampledChunkSize = CHUNK_FRAMES * OVERSAMPLE_FACTOR;
	const gWindowScratch = new Float32Array(upsampledChunkSize);

	// Thread sample rate / bit depth from the source cache. Both are
	// undefined-tolerant on `write`; passing them explicitly preserves
	// the metadata down the pipeline.
	const detectionSampleRate = detectionEnvelope.sampleRate;
	const detectionBitDepth = detectionEnvelope.bitDepth;

	for (;;) {
		const chunk = await detectionEnvelope.read(upsampledChunkSize);
		const windowChunk = chunk.samples[0];
		const chunkLength = windowChunk?.length ?? 0;

		if (windowChunk === undefined || chunkLength === 0) break;

		// Curve per output sample at 4× rate: `g[k] = 10^(gainDbAt(
		// linearToDb(window[k])) / 20)`. View into the persistent
		// `gWindowScratch` — fully overwritten by the fill loop below.
		const gWindowChunk = gWindowScratch.subarray(0, chunkLength);

		for (let outputIdx = 0; outputIdx < chunkLength; outputIdx++) {
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

		await forwardEnvelopeBuffer.write([forwardChunk], detectionSampleRate, detectionBitDepth);

		if (chunkLength < upsampledChunkSize) break;
	}

	// Ensure the backward pass (which reads via `readReverse`) sees a
	// consistent state. `readReverse` spans head-scratch / disk / tail-
	// scratch transparently, but flushing makes the contract obvious.
	await forwardEnvelopeBuffer.flushWrites();
}

interface MeasureAttemptArgs {
	/**
	 * 4×-upsampled per-channel source cache built ONCE at iteration
	 * entry. The per-attempt walk B reads this in chunks at upsampled
	 * rate, multiplies each channel by the chunk-aligned envelope slice,
	 * and downsamples — skipping the per-attempt upsample step.
	 */
	upsampledSource: ChunkBuffer;
	sampleRate: number;
	channelCount: number;
	/**
	 * 4×-rate smoothed gain envelope from this attempt's walks, held as
	 * a single-channel `ChunkBuffer` (per Phase 3 of
	 * `plan-loudness-target-stream-caching`: the envelope is disk-
	 * backed via `ChunkBuffer`, not a flat `Float32Array`). Frames
	 * count matches `upsampledSource.frames` exactly. Read in chunks
	 * in lockstep with `upsampledSource.read(CHUNK_FRAMES *
	 * OVERSAMPLE_FACTOR)` sequential.
	 */
	gSmoothed: ChunkBuffer;
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
 * Per-attempt body (walk B sub-pass B2), post-Phase-2-stream-caching:
 * iterate the upsampled-source CACHE (built once at iteration entry)
 * chunk-by-chunk, multiply by the chunk-aligned 4×-rate envelope
 * slice, and downsample via a fresh per-channel `Oversampler` set.
 * Parallel `LoudnessAccumulator` / `TruePeakAccumulator` consume the
 * downsampled chunks. Returns integrated LUFS, LRA, and 4× true peak
 * of the transformed signal.
 *
 * The per-attempt upsample step from the pre-cache pipeline is gone —
 * the cache absorbed it. Only the downsample side of the
 * `Oversampler` is exercised here. Downsamplers MUST be fresh per
 * attempt: their post-multiply input differs per attempt, so reusing
 * across attempts would corrupt the AA filter state.
 */
async function measureAttemptOutput(args: MeasureAttemptArgs): Promise<MeasureAttemptResult> {
	const { upsampledSource, sampleRate, channelCount, gSmoothed } = args;
	const accumulator = new LoudnessAccumulator(sampleRate, channelCount);
	const truePeakAccumulator = new TruePeakAccumulator(sampleRate, channelCount);

	// Fresh per-channel downsamplers. Distinct from walk A's
	// (now-deleted) detection set, from the cache-build set inside
	// `buildSourceUpsampledAndDetectionCaches`, and from the stream
	// class's persistent apply set. Each `Oversampler` here is used
	// for its `downsample` side only — the upsample side ran during
	// cache build.
	const downsamplers: Array<Oversampler> = [];

	for (let channelIdx = 0; channelIdx < channelCount; channelIdx++) {
		downsamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
	}

	// Persistent per-attempt output scratch: one `Float32Array` per
	// channel sized to the steady-state source-rate chunk length.
	// Reused across chunks via `subarray(0, chunkFrames)` for the
	// variable last-chunk length. Kept inside `measureAttemptOutput`
	// (not hoisted to `iterateForTargets`) per the Phase 1.3 plan —
	// the scratch is cheap (sized by chunk, not by source) and the
	// per-attempt-fresh pattern preserves clear ownership boundaries
	// with the `downsamplers` set.
	const applyOutputScratch: Array<Float32Array> = [];

	for (let channelIdx = 0; channelIdx < channelCount; channelIdx++) {
		applyOutputScratch.push(new Float32Array(CHUNK_FRAMES));
	}

	const upsampledChunkSize = CHUNK_FRAMES * OVERSAMPLE_FACTOR;

	// Rewind both caches' read cursors — each attempt reads them from
	// frame 0 in lockstep. Both are read-only at this point so reset()
	// just rewinds the read cursor; safe even if a prior attempt's
	// reads left the cursor mid-buffer.
	await upsampledSource.reset();
	await gSmoothed.reset();

	for (;;) {
		const upChunk = await upsampledSource.read(upsampledChunkSize);
		const upChunkFrames = upChunk.samples[0]?.length ?? 0;

		if (upChunkFrames === 0) break;

		// Source-rate chunk frames = upsampled chunk frames / factor.
		// Both the upsampled cache (post-build) and the source itself
		// have lengths that are exact multiples of `OVERSAMPLE_FACTOR`,
		// so this integer divide is exact for every chunk.
		const chunkFrames = upChunkFrames / OVERSAMPLE_FACTOR;
		// Chunk-aligned envelope slice — pulled from gSmoothed in
		// lockstep with the upsampled-source read. Both buffers were
		// reset above and are read forward; cursors stay aligned by
		// construction.
		const envelopeChunk = await gSmoothed.read(upChunkFrames);
		const envelopeSlice = envelopeChunk.samples[0];

		if (envelopeSlice?.length !== upChunkFrames) {
			throw new Error(
				`measureAttemptOutput: envelope ChunkBuffer returned ${envelopeSlice?.length ?? 0} samples; expected ${upChunkFrames}`,
			);
		}

		// Build per-chunk views into the persistent scratch so the
		// trailing short chunk gets correctly-sized slots (the
		// cache-fed apply helper validates `output[ch].length ===
		// upsampledChunkSamples[ch].length / factor`).
		const applyOutputView: Array<Float32Array> = applyOutputScratch.map(
			(slot) => slot.subarray(0, chunkFrames),
		);

		const transformed = applyOversampledChunkFromCache({
			upsampledChunkSamples: upChunk.samples,
			smoothedGain: envelopeSlice,
			downsamplers,
			factor: OVERSAMPLE_FACTOR,
			output: applyOutputView,
		});

		accumulator.push(transformed, chunkFrames);
		truePeakAccumulator.push(transformed, chunkFrames);

		if (upChunkFrames < upsampledChunkSize) break;
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
 *     with `MIN_SECANT_SLOPE` floor on slope magnitude and asymmetric
 *     damping based on error sign-flip.
 *
 * In the joint iteration the slope estimate is fit across attempts
 * where `peakGainDb` is also moving — non-stationary geometry. The
 * asymmetric damping (see below) is what bounds the contaminated
 * slope's step magnitude. Without it the iterator could runaway-
 * overshoot on coupled axes; the prior sequential design avoided
 * contamination by holding `peakGainDb` constant during the B-secant
 * phase. See the file-level JSDoc for the joint-vs-sequential
 * trade-off discussion.
 *
 * **Damping policy (asymmetric)**:
 *
 * - **Same-sign consecutive errors** (still descending one-sided
 *   toward target): NO cap. Trust the secant's predicted step. In
 *   this regime the secant's slope estimate is being validated each
 *   attempt (error keeps reducing in the same direction), so
 *   extrapolation is justified. Without trusting the secant here,
 *   the iterator can be bounded short of target by an arbitrarily
 *   chosen geometric series (the saddle-stall bug from the
 *   sequential-design QA — secant stalled at +1.5 dB residual because
 *   a 0.5× cap geometrically bounded total reach).
 *
 * - **Sign-flipped consecutive errors** (overshot target — we now
 *   sit on the opposite side): cap at `1 × previous step magnitude`.
 *   The previous-step point on the other side of target had error of
 *   opposite sign; reverting more than the full previous step would
 *   land beyond that known-bad point. 1× cap is the principled
 *   no-revert-past-known-bad rule; smaller (e.g. 0.5×) is over-
 *   conservative and geometrically truncates oscillation
 *   convergence. The secant's `step = -lufsErr / slope` already
 *   shrinks naturally as `|lufsErr| → 0`, so the cap only fires when
 *   the slope estimate is degenerate.
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
	// Asymmetric cap: same-sign descent → no cap, trust the secant;
	// sign-flip overshoot → cap at 1× previous step magnitude (don't
	// revert past the known-bad point on the other side of target).
	const signFlipped = last.lufsErr !== 0 && previous.lufsErr !== 0
		&& Math.sign(last.lufsErr) !== Math.sign(previous.lufsErr);
	const magnitudeCap = signFlipped && Number.isFinite(previousStepMagnitude)
		? previousStepMagnitude
		: Infinity;
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
