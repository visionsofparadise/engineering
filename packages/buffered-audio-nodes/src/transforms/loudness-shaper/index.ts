import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import type { CurveParams } from "./utils/curve";
import { iterateForTarget } from "./utils/iterate";
import { buildLUT, type LUT, lookupLUT } from "./utils/lut";
import { measureSourceLufsAndPeaks } from "./utils/measurement";

/**
 * Default LUT point count target. 512 cosine-spaced points across the
 * two ramp regions plus the flat-body / pass-through boundaries gives
 * a comfortable round-trip tolerance under linear interpolation.
 */
const DEFAULT_POINT_COUNT_TARGET = 512;

/**
 * Streaming chunk size for the learn pass's source measurement and the
 * per-attempt iteration walk. Matches `iterate.ts` and
 * `loudness-normalize/utils/measurement.ts`.
 */
const CHUNK_FRAMES = 44100;

/**
 * Oversampling factor for the streaming apply pass. Matches the design
 * doc's 4×; keep in sync with `apply-final.ts`'s `DEFAULT_FACTOR`.
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
 */
export const schema = z.object({
	target:        z.number().min(-50).max(0).multipleOf(0.1).default(-16).describe("Target integrated loudness (LUFS)"),
	floor:         z.number().lt(0).describe("Lower geometric anchor (dB). Below: pass-through."),
	bodyLow:       z.number().lt(0).describe("Low edge of full-boost body region (dB)."),
	bodyHigh:      z.number().lt(0).describe("High edge of full-boost body region (dB)."),
	preservePeaks: z.boolean().default(true).describe("true → smootherstep ramp 1 → 0 to source peak; false → body lift continues above bodyHigh"),
	warmth:        z.number().min(0).max(1).default(0).describe("Per-side asymmetry blend (0 = symmetric, 1 = per-side peak)"),
}).refine(
	({ floor, bodyLow, bodyHigh }) => floor < bodyLow && bodyLow <= bodyHigh && bodyHigh < 0,
	{ message: "loudnessShaper requires floor < bodyLow ≤ bodyHigh < 0 (dB)" },
);

export interface LoudnessShaperProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class LoudnessShaperStream extends BufferedTransformStream<LoudnessShaperProperties> {
	/**
	 * The winning LUT from the learn pass. Set in `_process`; consumed
	 * per-chunk in `_unbuffer`. Null means pass-through (silent /
	 * degenerate / sub-block-length input).
	 */
	private winningLut: LUT | null = null;

	/**
	 * Per-channel oversamplers, allocated once at the end of the learn
	 * pass and reused across every `_unbuffer` call. The Oversampler's
	 * biquad anti-alias state persists across calls (per
	 * `oversample.ts` design), so consecutive chunk emissions remain
	 * continuous — no chunk-boundary glitch.
	 */
	private oversamplers: Array<Oversampler> = [];

	/**
	 * Per-chunk wall-clock time spent in `_unbuffer` (the final-apply
	 * oversampled LUT path). Accumulated across all `_unbuffer` calls so
	 * the QA driver can read it after `render()` to break out the
	 * base-rate vs final-apply cost — useful for projecting render cost
	 * at higher oversample factors.
	 */
	public unbufferElapsedMs = 0;

	/**
	 * Wall-clock breakdown of the learn pass. Set in `_process`; read by
	 * the QA driver for cost projection.
	 */
	public learnTimingMs: { sourceMeasurement: number; iteration: number } = {
		sourceMeasurement: 0,
		iteration: 0,
	};

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channelCount = buffer.channels;
		const sampleRate = buffer.sampleRate ?? this.sampleRate ?? 44100;

		if (frames === 0 || channelCount === 0) return;

		const { target, floor, bodyLow, bodyHigh, preservePeaks, warmth } = this.properties;

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
		};
		const negParams: CurveParams = {
			floor: floorLin,
			bodyLow: bodyLowLin,
			bodyHigh: bodyHighLin,
			peak: preservePeaks ? negPeakLin : null,
		};

		// Degenerate guards: if the source has no audible signal on a
		// side, skip — no peak anchor → no curve.
		if (preservePeaks && (posPeakLin <= bodyHighLin || negPeakLin <= bodyHighLin)) {
			console.log(`[loudness-shaper] source peak below bodyHigh (posPeak=${posPeak.toExponential(3)} negPeak=${negPeak.toExponential(3)} bodyHigh=${bodyHighLin.toExponential(3)}); pass-through.`);

			return;
		}

		// 4. Iterate to find the winning boost. Each attempt re-walks the
		//    buffer via `buffer.iterate` and applies the LUT chunk-by-chunk
		//    into a per-channel scratch buffer.
		const tIter0 = Date.now();
		const result = await iterateForTarget({
			buffer,
			sampleRate,
			posParams,
			negParams,
			targetLUFS: target,
			sourceLUFS,
			pointCountTarget: DEFAULT_POINT_COUNT_TARGET,
			chunkFrames: CHUNK_FRAMES,
		});

		this.learnTimingMs.iteration = Date.now() - tIter0;

		// 5. Build the winning LUT and stand up the per-channel oversamplers
		//    used by `_unbuffer`. One Oversampler per channel; their biquad
		//    states persist across `_unbuffer` calls so consecutive chunks
		//    are continuous at chunk boundaries.
		this.winningLut = buildLUT(posParams, negParams, result.bestBoost, DEFAULT_POINT_COUNT_TARGET);
		this.oversamplers = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			this.oversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
		}

		const lastAttempt = result.attempts[result.attempts.length - 1];
		const lastIterationLufs = lastAttempt?.outputLUFS;

		console.log(
			`[loudness-shaper] target=${target.toFixed(2)} sourceLUFS=${sourceLUFS.toFixed(2)} ` +
				`bestBoost=${result.bestBoost.toFixed(4)} converged=${String(result.converged)} ` +
				`attempts=${String(result.attempts.length)} ` +
				`iterationLUFS=${lastIterationLufs === undefined ? "n/a" : lastIterationLufs.toFixed(2)} ` +
				`floor=${floor} bodyLow=${bodyLow} bodyHigh=${bodyHigh} ` +
				`preservePeaks=${String(preservePeaks)} warmth=${warmth}`,
		);
	}

	override _teardown(): void {
		// Print the wall-clock breakdown before the stream is destroyed so
		// the QA driver can read it from stdout. The unbuffer accumulator
		// captures the entire final-apply (oversampled LUT) cost; the
		// learn-pass numbers come from `_process`.
		if (this.winningLut !== null) {
			const total = this.learnTimingMs.sourceMeasurement + this.learnTimingMs.iteration + this.unbufferElapsedMs;

			console.log(
				`[loudness-shaper timing] sourceMeasurement=${this.learnTimingMs.sourceMeasurement}ms ` +
					`iteration=${this.learnTimingMs.iteration}ms ` +
					`finalApply=${this.unbufferElapsedMs}ms ` +
					`total=${total}ms ` +
					`baseRate=${this.learnTimingMs.sourceMeasurement + this.learnTimingMs.iteration}ms`,
			);
		}
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const lut = this.winningLut;

		if (lut === null) return chunk;

		const tStart = Date.now();
		const oversamplers = this.oversamplers;
		const transformed: Array<Float32Array> = chunk.samples.map((channel, channelIndex) => {
			const oversampler = oversamplers[channelIndex];

			if (oversampler === undefined || channel.length === 0) {
				// No oversampler for this channel (shouldn't happen — the
				// learn pass allocates one per channel) or empty input.
				// Pass through unchanged.
				return channel;
			}

			// LUT geometry handles below-floor and (when preservePeaks=true)
			// above-peak pass-through by construction — no per-sample gate.
			return oversampler.oversample(channel, (sample) => lookupLUT(lut, sample));
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

export function loudnessShaper(options: { target?: number; floor: number; bodyLow: number; bodyHigh: number; preservePeaks?: boolean; warmth?: number; id?: string }): LoudnessShaperNode {
	const parsed = schema.parse(options);

	return new LoudnessShaperNode({ ...parsed, id: options.id });
}
