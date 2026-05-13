/**
 * Sequential two-stage iteration for the loudnessTarget node — Phase A
 * converges `peakGainDb` (TP control) with `B` held constant; Phase B
 * converges `B` via 1D secant with `peakGainDb` frozen at Phase A's
 * terminal value.
 *
 * Per design-loudness-target §"Iteration" (post
 * `plan-loudness-target-sequential-iteration` rewrite). Per
 * design-transforms §"Memory discipline": the source itself is
 * streamed via `buffer.read(CHUNK_FRAMES)` loop until short chunk; never
 * materialised as a full-source-sized Float32Array at this level.
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
 * ## Sequential architecture (Phase A → Phase B)
 *
 * The third axis, `peakGainDb` (upper-segment right-endpoint anchor),
 * starts at the closed-form `effectiveTargetTp − limitDb`. It is
 * converged in **Phase A** via proportional feedback on observed
 * `outputTruePeakDb` overshoot — preserved from
 * `plan-loudness-target-tp-iteration`. Throughout Phase A `currentBoost`
 * is held constant at the RMS-shift initialiser; only `peakGainDb`
 * moves. Phase A exits when `peakOvershoot ≤ peakTolerance` (or budget
 * exhaustion, or `skipPeak`). Its terminal `peakGainDb` is **frozen**.
 *
 * **Phase B** then runs a 1D secant on `B` against LUFS error with
 * `peakGainDb` held at the frozen Phase A value. Phase B's first probe
 * applies the RMS-shift correction `B - lufsErr` to Phase A's last
 * measurement so that after one Phase B render the secant has 2 history
 * points at the same `peakGainDb` — a stationary fit. Subsequent
 * attempts feed `computeBoostStep` the **Phase-B-only filtered history**
 * so the slope estimate is not contaminated by Phase A points (whose
 * `peakGainDb` was different — non-stationary geometry, the bug this
 * architecture exists to prevent).
 *
 * The two phases share a single `bestScore` accumulator and the same
 * `forwardScratch` so the best-attempt fallback spans both phases.
 * Total attempt budget is `maxAttempts`. Phase A consumes up to
 * `PEAK_MAX_ATTEMPTS_DEFAULT` of it; Phase B gets the remainder.
 *
 * When `peakGainDb > B` the upper segment of the curve is expansive
 * (positive slope between pivot and limit). This is geometrically valid
 * — the brick-wall above `limitDb` caps output at `targetTp` regardless
 * of slope sign. The `index.ts._process` log line surfaces this case
 * with an expansion warning so listeners notice intentional / accidental
 * tail-region amplification (per `plan-loudness-target-percentile-
 * limit` §"Open question O4").
 *
 * Pipeline per attempt (post-Phase-4 4×-upsampled fused-streaming form),
 * identical for Phase A and Phase B:
 *   1. Build anchors `{ floorDb, pivotDb, limitDb, B, peakGainDb }`.
 *   2. **Walk A — fused streaming 4×-upsampled detect + max-pool +
 *      curve + forward IIR**: stream the source once via
 *      `buffer.read(CHUNK_FRAMES)` loop until short chunk, computing per
 *      chunk:
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
 * Phase A stepping (`peakGainDb` only, `B` held constant):
 *   - Proportional feedback: after each attempt, if `peakOvershoot >
 *     peakTolerance`, the next attempt's `currentPeakGainDb` is shifted
 *     down by `peakOvershoot * PEAK_DAMPING`. Bounded below by
 *     `PEAK_GAIN_DB_FLOOR`. Undershoot leaves the value untouched.
 *   - Exit: `peakOvershoot ≤ peakTolerance`, OR `skipPeak`, OR Phase A
 *     budget (`PEAK_MAX_ATTEMPTS_DEFAULT`) exhausted.
 *   - `lufsErr` is NOT a Phase A exit condition. Phase A only chases
 *     peak overshoot; LUFS convergence is Phase B's job.
 *
 * Phase B stepping (1D on `B`, `peakGainDb` frozen at Phase A's
 * terminal value):
 *   - First probe (seeded from Phase A's last measurement): full
 *     RMS-shift correction `B_next = B - lufsErr`.
 *   - Attempt ≥ 2 (one Phase B history point): classical 1D secant on
 *     the most recent two **Phase B** history points; minimum slope
 *     `MIN_SECANT_SLOPE` (0.05) to avoid degenerate steps. The history
 *     is filtered to `phase === "B"` so the secant fits slope on
 *     stationary `peakGainDb` only.
 *   - Step-magnitude damping is **asymmetric** (see `computeBoostStep`
 *     JSDoc for full rationale): same-sign consecutive errors
 *     (monotonic descent) → no cap; sign-flipped consecutive errors
 *     (overshoot crossed target) → cap at 1× previous step magnitude.
 *     Replaces a symmetric 0.5× cap that geometrically bounded total
 *     reach to `2 × previous_step` regardless of iteration budget.
 *   - `B` clamped to `[-30, 30]` dB (sanity bound — avoids runaway on
 *     numerically degenerate sources).
 *
 * Phase B convergence — two gates (checked in order each attempt):
 *   1. **Two-decimal-precision gate (always active)**: fires when
 *      `round(|lufsErr| × 100) === 0` AND
 *      `skipPeak || round(peakOvershoot × 100) === 0`. This is the
 *      "perfect to the user-visible precision" exit — the
 *      iteration-end log line reports `outputLufs` / `outputTruePeakDb`
 *      to two decimal places, so once both axes round to their
 *      targets at that precision additional attempts cannot improve
 *      the reported result. Unconditional — does NOT consult
 *      `tolerance` / `peakTolerance`.
 *   2. **Tolerance-based gate**: fires when `|lufsErr| < tolerance`
 *      AND `skipPeak || peakOvershoot ≤ peakTolerance`. Skipped
 *      silently when `tolerance` / `peakTolerance` are undefined
 *      (per the "undefined ⇒ run to budget" contract on the BAG
 *      schema). When both fields are defined, this gate may fire on
 *      attempts that do not round perfectly to two decimal places —
 *      callers who want strictly-perfect exits can omit both
 *      tolerances and rely solely on the precision gate.
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

/**
 * Default cap on Phase A (peakGainDb-only) attempts within the total
 * `maxAttempts` budget. Proportional feedback on TP overshoot
 * typically converges in 2–4 attempts; 5 leaves headroom for slow
 * sources without starving Phase B (B-secant). When `maxAttempts` is
 * smaller than this value, Phase A is capped at `maxAttempts` and
 * Phase B receives 0 attempts. Per
 * `plan-loudness-target-sequential-iteration` §"Approach".
 */
const PEAK_MAX_ATTEMPTS_DEFAULT = 5;

/** Single attempt's recorded state. */
export interface IterationAttempt {
	/**
	 * Which sub-iteration this attempt belongs to. `"A"` — Phase A
	 * (peakGainDb-only proportional feedback, `B` held constant).
	 * `"B"` — Phase B (1D secant on `B`, `peakGainDb` frozen at Phase
	 * A's terminal value). Diagnostic / dump-formatting field; also
	 * used internally to filter Phase B history when feeding
	 * `computeBoostStep` (so the secant only fits slope on
	 * stationary-`peakGainDb` points).
	 */
	phase: "A" | "B";
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
	/**
	 * Count of Phase A attempts in `attempts` (peakGainDb-only
	 * sub-iteration). Equal to `attempts.filter(a => a.phase === "A").
	 * length` but exposed directly so consumers (the `index.ts._process`
	 * iteration-end log line) don't have to recompute. Per
	 * `plan-loudness-target-sequential-iteration` §1.3.
	 */
	peakAttempts: number;
	/**
	 * Count of Phase B attempts in `attempts` (B-secant sub-iteration).
	 * Equal to `attempts.filter(a => a.phase === "B").length`.
	 */
	boostAttempts: number;
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
 * Run the sequential two-phase iteration. Phase A converges
 * `peakGainDb` via proportional feedback on TP overshoot with `B`
 * held constant; Phase B converges `B` via 1D secant on LUFS error
 * with `peakGainDb` frozen at Phase A's terminal value. Total
 * attempt budget is `maxAttempts`, split as up to
 * `PEAK_MAX_ATTEMPTS_DEFAULT` for Phase A and the remainder for
 * Phase B. Returns the best attempt's smoothed envelope (held by
 * reference for the apply pass), its `(B, limitDb, peakGainDb)`,
 * the attempt history, and per-phase attempt counts.
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
			peakAttempts: 0,
			boostAttempts: 0,
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
	// closed-form `0`, `peakOvershoot` is forced out of the
	// best-attempt score, and `peakConverged` is forced true.
	const skipPeak = targetTp === undefined;

	let currentBoost = clampBoost(targetLufs - sourceLufs);

	const attempts: Array<IterationAttempt> = [];
	let bestBoost = currentBoost;
	let bestPeakGainDb = currentPeakGainDb;
	let bestScore = Infinity;

	// =====================================================================
	// Phase A — peakGainDb-only sub-iteration. `currentBoost` held constant
	// at the RMS-shift initialiser. Proportional feedback on TP overshoot
	// drives `currentPeakGainDb` downward until `peakOvershoot ≤
	// peakTolerance` or the Phase A budget is exhausted (or `skipPeak`).
	// Exit is purely peak-based — `lufsErr` is NOT a Phase A exit
	// condition. Running Phase B (B-secant) before `peakGainDb` settles
	// is the contamination bug this architecture exists to prevent
	// (per plan-loudness-target-sequential-iteration §"Problem").
	// =====================================================================
	let peakAttempts = 0;
	const peakMaxAttempts = Math.min(maxAttempts, PEAK_MAX_ATTEMPTS_DEFAULT);

	for (let phaseAIdx = 0; phaseAIdx < peakMaxAttempts; phaseAIdx++) {
		const anchors: Anchors = {
			floorDb: anchorBase.floorDb,
			pivotDb: anchorBase.pivotDb,
			limitDb: currentLimit,
			B: currentBoost,
			peakGainDb: currentPeakGainDb,
		};

		// Walk A — curve + forward IIR over the pre-built 4×-rate
		// detection envelope cache. Writes into `forwardEnvelopeBuffer`
		// chunk-by-chunk; on exit `forwardEnvelopeBuffer` holds the
		// forward-IIR output at 4× rate, ready for the backward pass.
		// `forwardEnvelopeBuffer` was either cleared at end of the prior
		// iteration (loss / non-winning swap) or freshly-constructed on
		// the very first attempt; `activeRef` was cleared on the prior
		// iteration's exit branch (or is the freshly-constructed slot).
		await streamCurveAndForwardIir({
			detectionEnvelope: caches.detectionEnvelope,
			anchors,
			iir,
			forwardEnvelopeBuffer,
		});

		// Walk B sub-pass B1 — backward IIR over the forward-envelope
		// ChunkBuffer into the active smoothed-envelope buffer.
		// `activeRef` is the per-attempt destination; after this call
		// it holds the 4×-rate smoothed gain envelope for THIS attempt.
		await applyBackwardPassOverChunkBuffer({
			sourceBuffer: forwardEnvelopeBuffer,
			destBuffer: activeRef,
			iir,
			chunkSize: CHUNK_FRAMES * OVERSAMPLE_FACTOR,
		});

		// Walk B sub-pass B2 — source-streaming apply + LUFS / LRA / TP
		// measurement at 4× rate. Envelope is read chunk-by-chunk from
		// `activeRef`.
		const measured = await measureAttemptOutput({
			upsampledSource: caches.upsampledSource,
			sampleRate,
			channelCount,
			gSmoothed: activeRef,
		});

		const lufsErr = measured.outputLufs - targetLufs;
		const peakErr = measured.outputTruePeakDb - effectiveTargetTp;
		// In skip-peak mode `peakOvershoot` is forced to 0 so it does
		// not contribute to `bestScore` and does not gate Phase A exit.
		const peakOvershoot = skipPeak ? 0 : Math.max(0, peakErr);

		attempts.push({
			phase: "A",
			boost: currentBoost,
			limitDb: currentLimit,
			lufsErr,
			outputLra: measured.outputLra,
			peakGainDb: currentPeakGainDb,
			peakErr,
			peakOvershoot,
		});
		peakAttempts++;

		// Best-attempt fallback accumulates across both phases — a Phase
		// A attempt that happens to satisfy both axes simultaneously
		// (rare, but possible on near-passthrough sources) still wins
		// against any later Phase B attempt that drifts.
		const score = Math.sqrt(lufsErr * lufsErr + peakOvershoot * peakOvershoot);

		if (score < bestScore) {
			bestScore = score;
			bestBoost = currentBoost;
			bestPeakGainDb = currentPeakGainDb;
			// Swap: the just-written `activeRef` becomes the new winner;
			// the old `winningRef` (which held the previous winner's
			// envelope or is freshly-constructed) becomes the next
			// attempt's `activeRef`. After the swap the new `activeRef`
			// still holds stale data — clear it now so the next attempt
			// starts on an empty buffer (writeReverse / write both
			// accumulate, so an unflushed prior state would corrupt the
			// next attempt's output).
			const previousActive = activeRef;

			activeRef = winningRef;
			winningRef = previousActive;
			winningPopulated = true;
			await activeRef.clear();
		} else {
			// Loss: the just-written `activeRef` did not beat the held
			// winner. Clear it immediately rather than waiting for the
			// next attempt's top-of-loop reset — the new API has no
			// equivalent of `truncate(0)` at top-of-loop; clearing on
			// loss leaves both slots in a known state.
			await activeRef.clear();
		}

		// Forward-envelope buffer is transient per-attempt. Clear now so
		// the next attempt's Walk A starts on an empty buffer (Walk A
		// `write`s through `streamCurveAndForwardIir` accumulate, just
		// like the active buffer).
		await forwardEnvelopeBuffer.clear();

		// Phase A exits as soon as peak fits tolerance (or `skipPeak`).
		// Note: NO `lufsErr` check here — see banner above.
		if (skipPeak || peakOvershoot <= peakTolerance) break;
		if (phaseAIdx === peakMaxAttempts - 1) break;

		// Proportional feedback: drop `currentPeakGainDb` by
		// `peakOvershoot * PEAK_DAMPING`. Bounded by
		// `PEAK_GAIN_DB_FLOOR`. Self-stabilising on a single axis since
		// `currentBoost` is not moving here.
		currentPeakGainDb = Math.max(
			PEAK_GAIN_DB_FLOOR,
			currentPeakGainDb - peakOvershoot * PEAK_DAMPING,
		);
	}

	// Freeze peakGainDb at its Phase A terminal value. Phase B uses this
	// constant for every render — the precondition that lets the
	// B-secant fit slope on a stationary function.
	const frozenPeakGainDb = currentPeakGainDb;

	// =====================================================================
	// Phase B — 1D secant on `B` against LUFS error, `peakGainDb` frozen
	// at `frozenPeakGainDb`. The first Phase B probe applies the
	// RMS-shift correction `B - lufsErr` to Phase A's last measurement
	// (subsumes the old attempt-0→1 RMS-shift) so that after one Phase
	// B render the secant has 2 history points at the same
	// `peakGainDb`. Subsequent steps call `computeBoostStep` with the
	// **Phase-B-only filtered history** — mixing Phase A points
	// reintroduces the non-stationary-`peakGainDb` contamination.
	// =====================================================================
	const boostMaxAttempts = maxAttempts - peakAttempts;
	const lastPhaseA = attempts[attempts.length - 1];

	if (lastPhaseA !== undefined && boostMaxAttempts > 0) {
		currentBoost = clampBoost(lastPhaseA.boost - lastPhaseA.lufsErr);
	}

	let previousStepMagnitude = Infinity;
	let boostAttempts = 0;

	for (let phaseBIdx = 0; phaseBIdx < boostMaxAttempts; phaseBIdx++) {
		const anchors: Anchors = {
			floorDb: anchorBase.floorDb,
			pivotDb: anchorBase.pivotDb,
			limitDb: currentLimit,
			B: currentBoost,
			peakGainDb: frozenPeakGainDb,
		};

		// Both `forwardEnvelopeBuffer` and `activeRef` were cleared at
		// end of the prior iteration (or by Phase A's terminal cleanup).
		await streamCurveAndForwardIir({
			detectionEnvelope: caches.detectionEnvelope,
			anchors,
			iir,
			forwardEnvelopeBuffer,
		});

		await applyBackwardPassOverChunkBuffer({
			sourceBuffer: forwardEnvelopeBuffer,
			destBuffer: activeRef,
			iir,
			chunkSize: CHUNK_FRAMES * OVERSAMPLE_FACTOR,
		});

		const measured = await measureAttemptOutput({
			upsampledSource: caches.upsampledSource,
			sampleRate,
			channelCount,
			gSmoothed: activeRef,
		});

		const lufsErr = measured.outputLufs - targetLufs;
		const peakErr = measured.outputTruePeakDb - effectiveTargetTp;
		const peakOvershoot = skipPeak ? 0 : Math.max(0, peakErr);

		attempts.push({
			phase: "B",
			boost: currentBoost,
			limitDb: currentLimit,
			lufsErr,
			outputLra: measured.outputLra,
			peakGainDb: frozenPeakGainDb,
			peakErr,
			peakOvershoot,
		});
		boostAttempts++;

		const score = Math.sqrt(lufsErr * lufsErr + peakOvershoot * peakOvershoot);

		if (score < bestScore) {
			bestScore = score;
			bestBoost = currentBoost;
			bestPeakGainDb = frozenPeakGainDb;
			const previousActive = activeRef;

			activeRef = winningRef;
			winningRef = previousActive;
			winningPopulated = true;
			// Same clear-on-win as Phase A — see comment there. The new
			// `activeRef` (previously the winner) holds stale data; clear
			// to ready it for the next attempt's write-accumulating
			// passes.
			await activeRef.clear();
		} else {
			// Loss: clear the just-written active buffer now.
			await activeRef.clear();
		}

		// Forward-envelope buffer transient — clear before any potential
		// early return below.
		await forwardEnvelopeBuffer.clear();

		// Gate 1 — two-decimal-precision early exit. Always active.
		// Fires when both axes round to zero error at two decimal places
		// (the precision the iteration-end log reports `outputLufs` and
		// `outputTruePeakDb` at). Independent of `tolerance` /
		// `peakTolerance` so callers who omit those still get a perfect
		// exit when the iteration hits one. See the function-level JSDoc
		// "Phase B convergence — two gates" for the rationale.
		const matchesToTwoDp =
			Math.round(Math.abs(lufsErr) * 100) === 0
			&& (skipPeak || Math.round(peakOvershoot * 100) === 0);

		if (matchesToTwoDp) {
			return {
				bestSmoothedEnvelopeBuffer: winningRef,
				bestB: bestBoost,
				bestLimitDb: currentLimit,
				bestPeakGainDb,
				attempts,
				peakAttempts,
				boostAttempts,
				upsampledSource: caches.upsampledSource,
				converged: true,
			};
		}

		// Gate 2 — tolerance-based exit. Unchanged from pre-Phase-4.
		// Silently skipped when `tolerance` / `peakTolerance` are
		// undefined (the BAG omits them → "run to budget").
		const lufsConverged = Math.abs(lufsErr) < tolerance;
		const peakConverged = skipPeak || peakOvershoot <= peakTolerance;

		if (lufsConverged && peakConverged) {
			return {
				bestSmoothedEnvelopeBuffer: winningRef,
				upsampledSource: caches.upsampledSource,
				bestB: bestBoost,
				bestLimitDb: currentLimit,
				bestPeakGainDb,
				attempts,
				peakAttempts,
				boostAttempts,
				converged: true,
			};
		}

		if (phaseBIdx === boostMaxAttempts - 1) break;

		// Phase-B-only filtered history: `computeBoostStep` fits its
		// secant on the most recent two history points, so Phase A
		// points (with a different `peakGainDb`) must NOT be in scope.
		const phaseBHistory = attempts.filter((attempt) => attempt.phase === "B");
		const next = computeBoostStep(phaseBHistory, previousStepMagnitude);

		currentBoost = clampBoost(next.boost);
		previousStepMagnitude = next.stepMagnitude;
	}

		return {
			bestSmoothedEnvelopeBuffer: winningRef,
			upsampledSource: caches.upsampledSource,
			bestB: bestBoost,
			bestLimitDb: currentLimit,
			bestPeakGainDb,
			attempts,
			peakAttempts,
			boostAttempts,
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
 * **Damping policy (asymmetric)**:
 *
 * - **Same-sign consecutive errors** (still descending one-sided
 *   toward target): NO cap. Trust the secant's predicted step. In
 *   this regime the secant's slope estimate is being validated each
 *   attempt (error keeps reducing in the same direction), so
 *   extrapolation is justified. Without trusting the secant here,
 *   the iterator can be bounded short of target by an arbitrarily
 *   chosen geometric series (this was the saddle-stall bug in
 *   `plan-loudness-target-sequential-iteration`'s initial QA — Phase
 *   B stalled at +1.5 dB residual because the 0.5× cap geometrically
 *   bounded total reach).
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
