import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { applyFinalChunk } from "./utils/apply-final";
import type { CurveParams } from "./utils/curve";
import { iterateForTarget } from "./utils/iterate";
import { measureSourceLufsAndPeaks } from "./utils/measurement";

/**
 * Oversampling factor for the final-apply pass. Matches the design
 * doc's 4×; passed through to `apply-final.ts` per-channel
 * Oversampler instances.
 */
const OVERSAMPLE_FACTOR = 4;

/**
 * Schema for the loudnessShaper node.
 *
 * `floor` / `bodyLow` / `bodyHigh` are user-supplied dB anchors. They
 * are required (no defaults) — the agent always picks them from a stats
 * readout of the source. Ordering `floor < bodyLow ≤ bodyHigh < 0` is
 * enforced by `.refine()`.
 *
 * `preservePeaks = true` (default) anchors the peak: the curve ramps
 * down 1 → 0 across `[bodyHigh, sourcePeak]` and passes through above.
 * `preservePeaks = false` lets the body lift continue without an upper
 * roll-off (expander mode); samples may exceed the source peak.
 *
 * `warmth` blends BOTH sides' `peak` anchors between the symmetric
 * value (`max(posPeak, negPeak)`, shared) and the asymmetric value
 * (each side's own measured peak). At `warmth = 0` both sides use
 * the symmetric value (strict odd-harmonics-only); at `warmth = 1`
 * each side uses its own measured peak. Lerping both sides is
 * required so warmth produces audible asymmetry regardless of which
 * side has the larger magnitude (an earlier formulation that only
 * lerped the negative side produced zero asymmetry when
 * `negPeak >= posPeak`).
 *
 * `tensionLow` / `tensionHigh` are superellipse tensions on the two
 * ramps (floor → bodyLow and bodyHigh → peak respectively). `1` is the
 * linear default — minimum max-gradient across the ramp, minimum
 * body-region harmonic content. `> 1` bows convex (above the diagonal);
 * `< 1` bows concave. See the 2026-05-05 design decision for why linear
 * replaced smootherstep. `tensionHigh` is silently ignored when
 * `preservePeaks = false` (no upper ramp exists in that mode).
 *
 * Iteration is user-tunable via `tolerance` and `maxAttempts`. Defaults
 * (`0.5` LUFS dB / `10` attempts) are sized for the standalone-shaper
 * workflow where `loudnessShaper` is expected to land on target LUFS
 * without a downstream `loudnessNormalize` correction step. See the
 * 2026-05-05 "Tolerance and maxAttempts exposed" design decision.
 */
export const schema = z.object({
	target:        z.number().min(-50).max(0).multipleOf(0.1).default(-16).describe("Target integrated loudness (LUFS)"),
	floor:         z.number().lt(0).describe("Lower geometric anchor (dB). Below: pass-through."),
	bodyLow:       z.number().lt(0).describe("Low edge of full-boost body region (dB)."),
	bodyHigh:      z.number().lt(0).describe("High edge of full-boost body region (dB)."),
	preservePeaks: z.boolean().default(true).describe("true → tensioned ramp (linear default) 1 → 0 to source peak; false → body lift continues above bodyHigh"),
	warmth:        z.number().min(0).max(1).default(0).describe("Per-side asymmetry blend (0 = symmetric, 1 = per-side peak)"),
	tensionLow:    z.number().gt(0).default(1).describe("Superellipse tension on the floor → bodyLow ramp. (0, ∞), 1 = linear. > 1 convex (above diagonal); < 1 concave."),
	tensionHigh:   z.number().gt(0).default(1).describe("Superellipse tension on the bodyHigh → peak ramp. (0, ∞), 1 = linear. Silently ignored when preservePeaks = false."),
	tolerance:     z.number().gt(0).default(0.5).describe("Iteration exit threshold (LUFS dB). Smaller = more iterations to converge."),
	maxAttempts:   z.number().int().min(1).default(10).describe("Hard cap on iteration attempts. Closest-attempt fallback applies if exhausted."),
}).refine(
	({ floor, bodyLow, bodyHigh }) => floor < bodyLow && bodyLow <= bodyHigh && bodyHigh < 0,
	{ message: "loudnessShaper requires floor < bodyLow ≤ bodyHigh < 0 (dB)" },
);

export interface LoudnessShaperProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class LoudnessShaperStream extends BufferedTransformStream<LoudnessShaperProperties> {
	/**
	 * Per-side `CurveParams` resolved from user dB anchors + per-side
	 * peaks at iteration time. Consumed per chunk by `_unbuffer` (the
	 * curve is evaluated directly per oversampled sample). `null` when
	 * the stream passes through (silent / sub-floor / degenerate guard).
	 */
	private winningPosParams: CurveParams | null = null;
	private winningNegParams: CurveParams | null = null;

	/**
	 * Boost factor `B` chosen by the secant iteration. `null` when the
	 * stream passes through (no curve was learned).
	 */
	private winningBoost: number | null = null;

	/**
	 * Per-channel `Oversampler` instances allocated in `_process` and
	 * reused across all `_unbuffer` calls. The biquad states persist
	 * across chunks so chunk boundaries are continuous in the AA
	 * filter response — multi-chunk runs match single-chunk runs.
	 */
	private oversamplers: Array<Oversampler> | null = null;

	/**
	 * Per-chunk wall-clock time spent in `_unbuffer` (oversampling +
	 * per-sample curve + downsampling per chunk). Accumulated across
	 * all `_unbuffer` calls.
	 */
	public unbufferElapsedMs = 0;

	/**
	 * Wall-clock breakdown of the learn pass and final-apply
	 * preparation. `finalApply` here measures only the per-channel
	 * `Oversampler` allocation; the actual oversample → curve →
	 * downsample cost is per-chunk in `_unbuffer` and accumulated
	 * separately as `unbufferElapsedMs`.
	 */
	public learnTimingMs: { sourceMeasurement: number; iteration: number; finalApply: number } = {
		sourceMeasurement: 0,
		iteration: 0,
		finalApply: 0,
	};

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channelCount = buffer.channels;
		const sampleRate = buffer.sampleRate ?? this.sampleRate ?? 44100;

		if (frames === 0 || channelCount === 0) return;

		const { target, floor, bodyLow, bodyHigh, preservePeaks, warmth, tensionLow, tensionHigh, tolerance, maxAttempts } = this.properties;

		// --- Learn pass ---
		// 1. Source integrated LUFS + per-side peaks. Single streaming
		//    walk through the buffer; constant memory.
		const t0 = Date.now();
		const measurement = await measureSourceLufsAndPeaks(buffer, sampleRate);

		this.learnTimingMs.sourceMeasurement = Date.now() - t0;

		const { lufs: sourceLUFS, posPeak, negPeak } = measurement;

		if (!Number.isFinite(sourceLUFS)) {
			// Silent / sub-block-length signal: nothing measurable, no curve to apply.
			console.log(`[loudness-shaper] source has no measurable loudness (LUFS=${String(sourceLUFS)}); pass-through.`);

			return;
		}

		// 2. Convert user-supplied dB anchors to linear amplitudes.
		const floorLin = Math.pow(10, floor / 20);
		const bodyLowLin = Math.pow(10, bodyLow / 20);
		const bodyHighLin = Math.pow(10, bodyHigh / 20);

		// 3. Build per-side CurveParams. Warmth implementation: BOTH
		//    sides lerp their `peak` anchor between the symmetric value
		//    (max(posPeak, negPeak), shared by both sides) and their own
		//    measured peak. At warmth = 0 both sides use symmetricPeak →
		//    strict odd-harmonics-only symmetry. At warmth = 1 each side
		//    uses its own peak → full asymmetric. Lerping both sides
		//    ensures warmth produces measurable asymmetry regardless of
		//    which side has the larger magnitude.
		const symmetricPeak = Math.max(posPeak, negPeak);
		const posPeakLin = symmetricPeak + (posPeak - symmetricPeak) * warmth;
		const negPeakLin = symmetricPeak + (negPeak - symmetricPeak) * warmth;

		const posParams: CurveParams = {
			floor: floorLin,
			bodyLow: bodyLowLin,
			bodyHigh: bodyHighLin,
			peak: preservePeaks ? posPeakLin : null,
			tensionLow,
			tensionHigh,
		};
		const negParams: CurveParams = {
			floor: floorLin,
			bodyLow: bodyLowLin,
			bodyHigh: bodyHighLin,
			peak: preservePeaks ? negPeakLin : null,
			tensionLow,
			tensionHigh,
		};

		// Degenerate guards: if the source has no audible signal on a
		// side, skip — no peak anchor → no curve.
		if (preservePeaks && (posPeakLin <= bodyHighLin || negPeakLin <= bodyHighLin)) {
			console.log(`[loudness-shaper] source peak below bodyHigh (posPeak=${posPeak.toExponential(3)} negPeak=${negPeak.toExponential(3)} bodyHigh=${bodyHighLin.toExponential(3)}); pass-through.`);

			return;
		}

		// 4. Iterate to find the winning boost. `iterateForTarget`
		//    streams the source via `buffer.read(CHUNK_FRAMES)` per
		//    attempt — no source-sized Float32Array materialisation. Per-
		//    attempt allocation is bounded by chunk size.
		const tIter0 = Date.now();
		const result = await iterateForTarget({
			buffer,
			sampleRate,
			posParams,
			negParams,
			targetLUFS: target,
			sourceLUFS,
			toleranceLUFSdB: tolerance,
			maxAttempts,
		});

		this.learnTimingMs.iteration = Date.now() - tIter0;

		this.winningPosParams = posParams;
		this.winningNegParams = negParams;
		this.winningBoost = result.bestBoost;

		// 5. Allocate per-channel Oversampler instances. State persists
		//    across `_unbuffer` calls so chunk boundaries are
		//    continuous in the AA filter response — multi-chunk runs
		//    match single-chunk runs.
		const tFinal0 = Date.now();
		const oversamplers: Array<Oversampler> = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			oversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
		}

		this.oversamplers = oversamplers;

		this.learnTimingMs.finalApply = Date.now() - tFinal0;

		const lastAttempt = result.attempts[result.attempts.length - 1];
		const lastIterationLufs = lastAttempt?.outputLUFS;

		console.log(
			`[loudness-shaper] target=${target.toFixed(2)} sourceLUFS=${sourceLUFS.toFixed(2)} ` +
				`bestBoost=${result.bestBoost.toFixed(4)} converged=${String(result.converged)} ` +
				`attempts=${String(result.attempts.length)} ` +
				`iterationLUFS=${lastIterationLufs === undefined ? "n/a" : lastIterationLufs.toFixed(2)} ` +
				`floor=${floor} bodyLow=${bodyLow} bodyHigh=${bodyHigh} ` +
				`preservePeaks=${String(preservePeaks)} warmth=${warmth} ` +
				`tensionLow=${tensionLow} tensionHigh=${tensionHigh} ` +
				`tolerance=${tolerance} maxAttempts=${maxAttempts}`,
		);
	}

	override _teardown(): void {
		// Print the wall-clock breakdown before the stream is destroyed so
		// the QA driver can read it from stdout. `finalApply` measures
		// only the oversampler setup; per-chunk
		// oversample → curve → downsample shows up as
		// `unbufferElapsedMs`.
		if (this.winningBoost !== null) {
			const total = this.learnTimingMs.sourceMeasurement + this.learnTimingMs.iteration + this.learnTimingMs.finalApply + this.unbufferElapsedMs;

			console.log(
				`[loudness-shaper timing] sourceMeasurement=${this.learnTimingMs.sourceMeasurement}ms ` +
					`iteration=${this.learnTimingMs.iteration}ms ` +
					`finalApply=${this.learnTimingMs.finalApply}ms ` +
					`unbufferOversample=${this.unbufferElapsedMs}ms ` +
					`total=${total}ms ` +
					`baseRate=${this.learnTimingMs.sourceMeasurement + this.learnTimingMs.iteration}ms`,
			);
		}
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const posParams = this.winningPosParams;
		const negParams = this.winningNegParams;
		const boost = this.winningBoost;
		const oversamplers = this.oversamplers;

		// Pass-through when no curve was learned (silent / sub-floor /
		// degenerate guard). Preserves the existing pass-through
		// semantics from the prior architecture.
		if (posParams === null || negParams === null || boost === null || oversamplers === null) return chunk;

		const tStart = Date.now();
		const transformed = applyFinalChunk({
			chunkSamples: chunk.samples,
			boost,
			posParams,
			negParams,
			oversamplers,
		});

		this.unbufferElapsedMs += Date.now() - tStart;

		return { samples: transformed, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class LoudnessShaperNode extends TransformNode<LoudnessShaperProperties> {
	static override readonly moduleName = "LoudnessShaper";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Trapezoidal-shape content-adaptive amplitude waveshaper that lifts the body of the distribution toward a target LUFS — body-density gain without limiting";
	static override readonly schema = schema;
	static override is(value: unknown): value is LoudnessShaperNode {
		return TransformNode.is(value) && value.type[2] === "loudness-shaper";
	}

	override readonly type = ["buffered-audio-node", "transform", "loudness-shaper"] as const;

	constructor(properties: LoudnessShaperProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): LoudnessShaperStream {
		return new LoudnessShaperStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<LoudnessShaperProperties>): LoudnessShaperNode {
		return new LoudnessShaperNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function loudnessShaper(options: { target?: number; floor: number; bodyLow: number; bodyHigh: number; preservePeaks?: boolean; warmth?: number; tensionLow?: number; tensionHigh?: number; tolerance?: number; maxAttempts?: number; id?: string }): LoudnessShaperNode {
	const parsed = schema.parse(options);

	return new LoudnessShaperNode({ ...parsed, id: options.id });
}
