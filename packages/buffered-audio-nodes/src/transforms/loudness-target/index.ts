import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { applyOversampledChunk } from "./utils/apply";
import { OVERSAMPLE_FACTOR, iterateForTargets } from "./utils/iterate";
import { measureSource } from "./utils/measurement";

/**
 * Minimum separation enforced internally between `floor` and `pivot`
 * when auto-derivation (or user combination with auto on the other axis)
 * would land floor at or above pivot. The lower segment of the curve is
 * a linear ramp normalised by `(pivot - floor)` (see `curve.ts`); equal
 * values would divide by zero. 0.01 dB is below the audible JND for
 * level and well under any measurement uncertainty.
 */
const FLOOR_PIVOT_EPSILON_DB = 0.01;

/**
 * Schema for the loudnessTarget node.
 *
 * Peak-aware sibling of `loudnessExpander`: same iterate-to-LUFS frame
 * with a peak-respecting smoothed gain envelope, but extends the curve
 * with an upper-arm peak anchor that gives structural control over
 * `targetTp`. See design-loudness-target §"Parameters" for the
 * parameter rationale and §"Two-pass node structure" for the stream
 * structure.
 *
 * `pivot` is optional; when undefined the node derives it from
 * `median(considered LRA blocks)` (BS.1770 / EBU R128 two-stage gate)
 * on the pass-1 measurement — see design-loudness-target §"Pivot
 * semantic — lower bound of the gain-riding zone". `floor` is
 * optional; when undefined the curve has no pass-through region and
 * applies uniform body gain B below pivot. The `.refine()` enforces
 * `floor < pivot` only when both are set; per-field `.lt(0)` still
 * constrains each to dB < 0 when supplied.
 *
 * Iteration is 1D on `B` (body gain). `limitDb` is set ONCE from the
 * measurement (or an explicit override) and is constant across attempts.
 * `peakGainDb` is derived per attempt from the closed form
 * `effectiveTargetTp − limitDb` with proportional feedback on observed
 * TP overshoot (per `plan-loudness-target-tp-iteration`). LRA falls out
 * as a consequence of the resulting geometry — there is no LRA target
 * axis (see `plan-loudness-target-percentile-limit` Decisions log).
 *
 * `targetTp` is the do-no-harm-default peak axis:
 *   - `targetTp` undefined → `effectiveTargetTp = sourcePeakDb` and
 *     `peakGainDb` collapses to 0; peaks track body lift unchanged.
 *
 * `limitDb` is the limit-anchor override. Default behaviour:
 *   - unset → top-down percentile walk over the source's 4×-rate
 *     detection-envelope histogram (`measureSource`'s `limitAutoDb`),
 *     parameterised by `limitPercentile`.
 *   - set → fix the limit anchor at this value (clamped to the per-
 *     source feasible window inside the iterator).
 *
 * `limitPercentile` selects the brick-wall threshold's statistical
 * quantile on the detection histogram: with default `0.995` the top
 * 0.5 % of detection samples sit above `limitAutoDb` and brick-wall at
 * the target ceiling. Higher values → less limiting (tighter quantile);
 * lower values → more aggressive limiting.
 *
 * `smoothing` is the peak-respecting envelope time constant in ms;
 * collapses `K = W` window-half-width and bidirectional IIR time
 * constant into one user parameter.
 */
export const schema = z.object({
	targetLufs:    z.number().min(-50).max(0).multipleOf(0.1).default(-16).describe("Target integrated loudness (LUFS)"),
	pivot:         z.number().lt(0).optional().describe("Body anchor (dB). Default: median(considered LRA blocks) from BS.1770 LRA gating in pass 1."),
	floor:         z.number().lt(0).optional().describe("Silence threshold (dB). Default: min(considered LRA blocks); no floor when no blocks survive gating."),
	limitPercentile: z.number().min(0.5).max(1.0).default(0.995).describe("Top-1−p fraction of detection samples to brick-wall. Default 0.995 brick-walls the top 0.5%."),
	limitDb:       z.number().lt(0).optional().describe("Limit-anchor override (dB). Default: auto-derived from quantile(detection histogram, limitPercentile). Set explicitly to fix the limit anchor."),
	maxAttempts:   z.number().int().min(1).default(10).describe("Hard cap on iteration attempts."),
	targetTp:      z.number().lt(0).optional().describe("True-peak target (dBTP). Default: source true peak (peaks unchanged)."),
	smoothing:     z.number().min(0.01).max(200).default(1).describe("Peak-respecting envelope time constant (ms)."),
	tolerance:     z.number().gt(0).default(0.5).describe("Iteration exit threshold (LUFS dB)."),
	peakTolerance: z.number().gt(0).default(0.1).describe("One-sided iteration exit threshold for output true-peak overshoot (dBTP; ceiling — undershoot ignored)."),
}).refine(
	({ floor, pivot }) => floor === undefined || pivot === undefined || floor < pivot,
	{ message: "loudnessTarget requires floor < pivot when floor is set" },
);

export interface LoudnessTargetProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class LoudnessTargetStream extends BufferedTransformStream<LoudnessTargetProperties> {
	/**
	 * 4×-upsampled peak-respecting smoothed gain envelope produced by
	 * the winning iteration attempt. Size is `frames * OVERSAMPLE_FACTOR`.
	 * `_unbuffer` passes it directly into `applyOversampledChunk`, which
	 * does the source-rate-`offset`-to-upsampled-index mapping
	 * internally. `null` when the stream passes through (silent / sub-
	 * block-length source).
	 */
	private winningSmoothedEnvelope: Float32Array | null = null;

	/**
	 * Body gain `B` chosen by 1D secant iteration on the LUFS error
	 * (limit is fixed per-source from the percentile, peakGainDb tracks
	 * via proportional feedback on TP overshoot). `null` when the
	 * stream passes through (no curve was learned). Diagnostic only —
	 * the apply pass uses the materialised envelope, not the boost
	 * directly.
	 */
	private winningB: number | null = null;

	/**
	 * Limit anchor `limitDb` used for this source — constant across
	 * iteration attempts. Sourced from `limitDbOverride` when explicit,
	 * else from the percentile-derived `limitAutoDb` on the source's
	 * detection-envelope histogram, else `sourcePeakDb` (no limiting).
	 * `null` when the stream passes through. Diagnostic only.
	 */
	private winningLimitDb: number | null = null;

	/**
	 * `peakGainDb` from the winning attempt — the upper-segment right-
	 * endpoint anchor gain. Starts at the closed-form
	 * `(targetTp ?? sourcePeakDb) - sourcePeakDb` and adjusts downward
	 * via proportional feedback on observed `outputTruePeakDb` overshoot
	 * (per `plan-loudness-target-tp-iteration`). `null` when the stream
	 * passes through. Diagnostic only — the apply pass uses the
	 * materialised envelope, not the anchor directly.
	 */
	private winningPeakGainDb: number | null = null;

	/**
	 * Per-channel `Oversampler` instances allocated in `_process` and
	 * reused across all `_unbuffer` calls. The biquad states persist
	 * across chunks so chunk boundaries are continuous in the AA
	 * filter response — multi-chunk runs match single-chunk runs.
	 *
	 * Mirrors `loudnessShaper`'s persistent-oversampler pattern. These
	 * are the FINAL apply set — distinct from any per-walk oversamplers
	 * the iteration loop allocates internally (those would absorb the
	 * source's history and corrupt the apply path if reused here).
	 */
	private oversamplers: Array<Oversampler> | null = null;

	/**
	 * Per-chunk wall-clock time spent in `_unbuffer` (oversample +
	 * per-sample multiply + downsample per chunk). Accumulated across
	 * all `_unbuffer` calls.
	 */
	public unbufferElapsedMs = 0;

	/**
	 * Wall-clock breakdown of the learn pass. Mirrors the expander's
	 * `learnTimingMs` for QA driver parity. `iteration` stays at 0
	 * until Phase 3 wires the iteration loop in.
	 */
	public learnTimingMs: { sourceMeasurement: number; detection: number; iteration: number } = {
		sourceMeasurement: 0,
		detection: 0,
		iteration: 0,
	};

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channelCount = buffer.channels;
		const sampleRate = buffer.sampleRate ?? this.sampleRate ?? 44100;

		if (frames === 0 || channelCount === 0) return;

		const { targetLufs, targetTp, limitDb: limitDbOverride, limitPercentile, smoothing, tolerance, peakTolerance, maxAttempts } = this.properties;

		// --- Learn pass ---
		// 1. Source measurement — single chunked walk producing
		//    integrated LUFS, LRA, 4× true peak, and the percentile-
		//    derived `limitAutoDb` in one pass.
		const tMeasure0 = Date.now();
		const measurement = await measureSource(buffer, sampleRate, limitPercentile);

		this.learnTimingMs.sourceMeasurement = Date.now() - tMeasure0;

		const { integratedLufs: sourceLufs, lra: sourceLra, truePeakDb: sourcePeakDb } = measurement;

		if (!Number.isFinite(sourceLufs)) {
			// Silent / sub-block-length signal: nothing measurable, no
			// curve to apply. Pass-through.
			console.log(`[loudness-target] source has no measurable loudness (LUFS=${String(sourceLufs)}); pass-through.`);

			return;
		}

		// 1a. Effective pivot — user-supplied if present, else
		//     auto-derived from `median(considered LRA blocks)` (BS.1770 /
		//     EBU R128 two-stage gate) carried on the measurement. The
		//     `+Infinity` sentinel from `pivotAutoDb` indicates no
		//     considered blocks survived gating (pathological short
		//     non-silent source); fall back to a fixed `-40` dBFS so
		//     the node stays functional and warn so the caller can
		//     supply `pivot` explicitly.
		const userPivot = this.properties.pivot;
		let effectivePivotDb: number;

		if (userPivot !== undefined) {
			effectivePivotDb = userPivot;
		} else if (Number.isFinite(measurement.pivotAutoDb)) {
			effectivePivotDb = measurement.pivotAutoDb;
			console.log(
				`[loudness-target] pivot auto-derived to ${effectivePivotDb.toFixed(2)} dBFS (median(considered LRA blocks))`,
			);
		} else {
			// Pre-Execution Review open question: non-silent source with no
			// considered LRA blocks. Fixed sentinel keeps the node functional;
			// warn so caller can supply pivot explicitly.
			effectivePivotDb = -40;
			console.warn(
				`[loudness-target] pivot auto-derivation produced no considered LRA blocks; falling back to ${effectivePivotDb} dBFS. Supply 'pivot' explicitly for tighter control on short or near-silent sources.`,
			);
		}

		// 1b. Effective floor — user-supplied if present, else
		//     auto-derived from `min(considered LRA blocks)` (the lowest
		//     short-term LUFS block that survived BS.1770 / EBU R128
		//     two-stage gating). Pairs with the median-pivot heuristic:
		//     pivot=median sets the body anchor, floor=min sets the
		//     lower-segment roll-off start so the curve doesn't lift
		//     ungated noise floor under the body.
		//
		//     The `+Infinity` sentinel indicates no considered blocks;
		//     in that case stay floor-off.
		//
		//     INTERNAL CLAMP: floor must stay strictly below pivot — the
		//     curve's lower-segment linear ramp divides by `(pivot - floor)`
		//     (see `curve.ts:gainDbAt`). The schema's `.refine` enforces
		//     `floor < pivot` for user-supplied combinations, but auto-
		//     derived `min(considered)` can land above a user-supplied
		//     pivot, and a user-supplied floor combined with an auto-
		//     derived pivot is not pre-validated. Clamp to
		//     `pivot - FLOOR_PIVOT_EPSILON_DB` whenever the derived value
		//     would sit at or above pivot.
		const userFloor = this.properties.floor;
		let effectiveFloorDb: number | null;

		if (userFloor !== undefined) {
			effectiveFloorDb = userFloor;
		} else if (Number.isFinite(measurement.floorAutoDb)) {
			effectiveFloorDb = measurement.floorAutoDb;
			console.log(
				`[loudness-target] floor auto-derived to ${effectiveFloorDb.toFixed(2)} dBFS (min(considered LRA blocks))`,
			);
		} else {
			effectiveFloorDb = null;
		}

		if (effectiveFloorDb !== null && effectiveFloorDb >= effectivePivotDb) {
			const clampedFloorDb = effectivePivotDb - FLOOR_PIVOT_EPSILON_DB;

			console.log(
				`[loudness-target] floor (${effectiveFloorDb.toFixed(2)} dBFS) >= pivot (${effectivePivotDb.toFixed(2)} dBFS); clamping floor to ${clampedFloorDb.toFixed(3)} dBFS (pivot - ${FLOOR_PIVOT_EPSILON_DB} dB).`,
			);
			effectiveFloorDb = clampedFloorDb;
		}

		// 2. Iteration — 1D secant on body gain `B` per
		//    design-loudness-target §"Iteration" (post
		//    `plan-loudness-target-percentile-limit` rewrite). `limitDb`
		//    is set ONCE at iteration entry from the auto-derivation
		//    table (`limitDbOverride` → percentile-derived `limitAutoDb`
		//    → `sourcePeakDb`) and is constant across attempts.
		//    `peakGainDb` starts at the closed-form `effectiveTargetTp −
		//    currentLimit` and adjusts per attempt via proportional
		//    feedback on observed TP overshoot. The cached source-sized
		//    linked-detection envelope was dropped in Phase 2 of the
		//    upsampled-streaming refactor; detection is now recomputed
		//    chunk-by-chunk inside walk A. The `learnTimingMs.detection`
		//    field is preserved for QA-driver log parity but always
		//    emits 0 — the detection cost is folded into iteration
		//    timing.
		const tIterate0 = Date.now();
		const result = await iterateForTargets({
			buffer,
			sampleRate,
			anchorBase: { floorDb: effectiveFloorDb, pivotDb: effectivePivotDb },
			smoothingMs: smoothing,
			targetLufs,
			targetTp,
			limitDbOverride,
			limitAutoDb: measurement.limitAutoDb,
			sourceLufs,
			sourcePeakDb,
			maxAttempts,
			tolerance,
			peakTolerance,
		});

		this.learnTimingMs.iteration = Date.now() - tIterate0;
		this.winningSmoothedEnvelope = result.bestSmoothedEnvelope;
		this.winningB = result.bestB;
		this.winningLimitDb = result.bestLimitDb;
		this.winningPeakGainDb = result.bestPeakGainDb;

		// Allocate per-channel `Oversampler` instances for the final
		// apply pass. State persists across `_unbuffer` calls so chunk
		// boundaries are continuous in the AA filter response —
		// multi-chunk runs match single-chunk runs. Mirrors
		// `loudnessShaper`'s pattern (see `loudness-shaper/index.ts`).
		// Phase 4: the winning envelope (`bestSmoothedEnvelope`) is at
		// 4× rate. `_unbuffer` passes both the envelope and the
		// source-rate `chunk.offset` into `applyOversampledChunk`,
		// which does the upsample → multiply by 4×-rate gain →
		// downsample. These oversamplers are DISTINCT from any
		// per-walk oversamplers the iteration loop allocates internally
		// (those have absorbed the source's history during measurement
		// walks and would corrupt the apply path if reused here).
		const oversamplers: Array<Oversampler> = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			oversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
		}

		this.oversamplers = oversamplers;

		const lastAttempt = result.attempts[result.attempts.length - 1];
		const outputLufsRepr = lastAttempt ? (targetLufs + lastAttempt.lufsErr).toFixed(2) : "n/a";
		// `outputLraRepr` is observational only — LRA is no longer a
		// target axis. The iterator's `lastAttempt.outputLra` carries the
		// measured value from the winning attempt's smoothing pass.
		const outputLraRepr = lastAttempt ? lastAttempt.outputLra.toFixed(2) : "n/a";
		const lufsDeltaRepr = lastAttempt ? lastAttempt.lufsErr.toFixed(2) : "n/a";
		// TP reconstruction mirrors the LUFS pattern:
		// `outputTruePeakDb = effectiveTargetTp + peakErr`, where
		// `effectiveTargetTp = targetTp ?? sourcePeakDb` (matches the
		// iterator's collapse of the `targetTp` default into a usable
		// ceiling).
		const effectiveTargetTp = targetTp ?? sourcePeakDb;
		const outputTruePeakRepr = lastAttempt ? (effectiveTargetTp + lastAttempt.peakErr).toFixed(2) : "n/a";
		const peakDeltaRepr = lastAttempt ? lastAttempt.peakErr.toFixed(2) : "n/a";
		const bestPeakGainDbRepr = result.bestPeakGainDb.toFixed(4);
		const bestLimitDbRepr = result.bestLimitDb.toFixed(4);
		const pivotRepr = userPivot === undefined
			? `${effectivePivotDb.toFixed(2)} (auto)`
			: String(userPivot);
		const floorRepr = userFloor !== undefined
			? String(userFloor)
			: effectiveFloorDb === null
				? "none"
				: `${effectiveFloorDb.toFixed(2)} (auto)`;
		// `limitDbRepr` summarises which arm of the auto-derivation table
		// fired. The iterator's `bestLimitDb` carries the numeric winner;
		// this label classifies how the initial value was sourced so the
		// QA log makes the dispatch decision visible.
		let limitDbSource: "user" | "auto" | "none";

		if (limitDbOverride !== undefined) {
			limitDbSource = "user";
		} else if (Number.isFinite(measurement.limitAutoDb)) {
			limitDbSource = "auto";
		} else {
			limitDbSource = "none";
		}

		const limitDbRepr = `${bestLimitDbRepr} (${limitDbSource})`;
		// Expansion-flag suffix: when `peakGainDb > B` at convergence the
		// upper segment of the curve is expansive (positive slope between
		// pivot and limit). Geometrically valid — the brick-wall above
		// `limitDb` still caps output at `targetTp` — but worth surfacing
		// for the listener / QA reader. Per `plan-loudness-target-
		// percentile-limit` Pre-Execution Review §"Open question O4".
		const expansiveGeometry = result.bestPeakGainDb > result.bestB;
		const expansionSuffix = expansiveGeometry ? " EXPANSIVE_UPPER_SEGMENT" : "";

		// Per-attempt trajectory dump — diagnostic for iteration
		// trajectory (does the secant converge, oscillate, or stall?).
		// One line per attempt with the moving knobs (B, peakGainDb) and
		// observed deviations from target.
		for (let attemptIdx = 0; attemptIdx < result.attempts.length; attemptIdx++) {
			const attempt = result.attempts[attemptIdx];

			if (attempt === undefined) continue;
			console.log(
				`[loudness-target] attempt ${(attemptIdx + 1).toString().padStart(2)}: ` +
					`B=${attempt.boost.toFixed(4).padStart(9)} ` +
					`peakGainDb=${attempt.peakGainDb.toFixed(4).padStart(9)} ` +
					`lufsErr=${attempt.lufsErr.toFixed(4).padStart(8)} ` +
					`peakErr=${attempt.peakErr.toFixed(4).padStart(8)} ` +
					`peakOvershoot=${attempt.peakOvershoot.toFixed(4).padStart(7)} ` +
					`outputLra=${attempt.outputLra.toFixed(4).padStart(7)}`,
			);
		}

		console.log(
			`[loudness-target] iteration: attempts=${result.attempts.length} converged=${String(result.converged)} ` +
				`bestB=${result.bestB.toFixed(4)} bestLimitDb=${bestLimitDbRepr} bestPeakGainDb=${bestPeakGainDbRepr} ` +
				`outputLufs=${outputLufsRepr} (Δ${lufsDeltaRepr}) outputLra=${outputLraRepr} ` +
				`outputTruePeakDb=${outputTruePeakRepr} (Δ${peakDeltaRepr}) ` +
				`targetLufs=${targetLufs.toFixed(2)} ` +
				`targetTp=${targetTp === undefined ? "source" : String(targetTp)} ` +
				`limitDb=${limitDbRepr} limitPercentile=${limitPercentile} ` +
				`sourceLufs=${sourceLufs.toFixed(2)} sourcePeakDb=${sourcePeakDb.toFixed(2)} sourceLra=${sourceLra.toFixed(2)} ` +
				`pivot=${pivotRepr} floor=${floorRepr} ` +
				`smoothing=${smoothing} tolerance=${tolerance} peakTolerance=${peakTolerance} maxAttempts=${maxAttempts}` +
				expansionSuffix,
		);

		if (expansiveGeometry) {
			console.warn(
				`[loudness-target] peakGainDb (${bestPeakGainDbRepr}) > B (${result.bestB.toFixed(4)}); upper segment of curve is expansive between pivot and limit. Brick-wall above limit still caps output at targetTp — note for listening QA.`,
			);
		}
	}

	override _teardown(): void {
		// Print the wall-clock breakdown before the stream is destroyed
		// so the QA driver can read it from stdout. Mirrors the
		// expander's timing summary. `iteration` is the wall time
		// spent inside `iterateForTargets` (per-attempt envelope build
		// + measurement walk × attempts).
		if (this.winningSmoothedEnvelope !== null) {
			const total = this.learnTimingMs.sourceMeasurement + this.learnTimingMs.detection + this.learnTimingMs.iteration + this.unbufferElapsedMs;
			const bRepr = this.winningB === null ? "n/a" : this.winningB.toFixed(4);
			const limitDbRepr = this.winningLimitDb === null ? "n/a" : this.winningLimitDb.toFixed(4);
			const peakGainDbRepr = this.winningPeakGainDb === null ? "n/a" : this.winningPeakGainDb.toFixed(4);

			console.log(
				`[loudness-target timing] sourceMeasurement=${this.learnTimingMs.sourceMeasurement}ms ` +
					`detection=${this.learnTimingMs.detection}ms ` +
					`iteration=${this.learnTimingMs.iteration}ms ` +
					`unbufferApply=${this.unbufferElapsedMs}ms ` +
					`total=${total}ms winningB=${bRepr} winningLimitDb=${limitDbRepr} winningPeakGainDb=${peakGainDbRepr}`,
			);
		}
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const smoothedGain = this.winningSmoothedEnvelope;
		const oversamplers = this.oversamplers;

		// Pass-through when no envelope was learned (silent /
		// sub-block-length source, no curve to apply). The
		// pass-through bail at the top of `_process` leaves
		// `oversamplers` at `null`, mirrored here for safety.
		if (smoothedGain === null || oversamplers === null) return chunk;

		const tStart = Date.now();
		const transformed = applyOversampledChunk({
			chunkSamples: chunk.samples,
			smoothedGain,
			offset: chunk.offset,
			oversamplers,
			factor: OVERSAMPLE_FACTOR,
		});

		this.unbufferElapsedMs += Date.now() - tStart;

		return { samples: transformed, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class LoudnessTargetNode extends TransformNode<LoudnessTargetProperties> {
	static override readonly moduleName = "LoudnessTarget";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Peak-aware content-adaptive curve fitting (LUFS, true-peak, LRA) via a single combined gain envelope with a peak-respecting two-stage smoother. Generalises `loudnessExpander` by adding an upper-arm peak anchor.";
	static override readonly schema = schema;
	static override is(value: unknown): value is LoudnessTargetNode {
		return TransformNode.is(value) && value.type[2] === "loudness-target";
	}

	override readonly type = ["buffered-audio-node", "transform", "loudness-target"] as const;

	constructor(properties: LoudnessTargetProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): LoudnessTargetStream {
		return new LoudnessTargetStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<LoudnessTargetProperties>): LoudnessTargetNode {
		return new LoudnessTargetNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function loudnessTarget(options: { targetLufs?: number; pivot?: number; floor?: number; targetTp?: number; limitPercentile?: number; limitDb?: number; smoothing?: number; tolerance?: number; peakTolerance?: number; maxAttempts?: number; id?: string }): LoudnessTargetNode {
	const parsed = schema.parse(options);

	return new LoudnessTargetNode({ ...parsed, id: options.id });
}
