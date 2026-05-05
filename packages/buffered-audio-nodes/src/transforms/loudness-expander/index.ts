import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { applySmoothedGainChunk } from "./utils/apply";
import { computeLinkedDetection } from "./utils/detect";
import { iterateForTarget } from "./utils/iterate";
import { measureSourceLufs } from "./utils/measurement";

/**
 * Schema for the loudnessExpander node.
 *
 * Sidebands-axis sibling of `loudnessShaper`: same iterate-to-LUFS frame
 * and same `B`-as-boost-factor mechanism, but with a single-pivot
 * transfer curve and a bidirectional-IIR-smoothed gain envelope. See
 * design-loudness-expander §"Parameters" for the parameter rationale and
 * §"Two-pass node structure" for the stream structure.
 *
 * `floor` and `pivot` are required user-supplied dB anchors. The agent
 * picks them from a stats readout of the source (typical mapping: `floor`
 * 5–10 dB above the noise cluster top; `pivot` near the body p50). Strict
 * ordering `floor < pivot < 0` is enforced by `.refine()` plus the
 * per-field `.lt(0)`.
 *
 * `tension`, `tolerance`, `maxAttempts` carry the same semantics as the
 * shaper (per the 2026-05-05 decisions in design-loudness-shaper).
 *
 * `smoothing` is the defining mechanism — bidirectional IIR time
 * constant on the gain envelope. Range `0.01 .. 200 ms`, default `1 ms`.
 * The lower bound is "user-chose-no-op"; the upper bound approaches
 * `loudnessNormalize` behaviour with a content-shaped offset.
 *
 * Explicit non-features (per design): no `warmth`, no `preservePeaks`,
 * no `oversampling`, no per-side params. Peaks may rise unbounded by
 * curve — chain a `truePeakLimit` downstream for spec compliance.
 */
export const schema = z.object({
	target:      z.number().min(-50).max(0).multipleOf(0.1).default(-16).describe("Target integrated loudness (LUFS)"),
	floor:       z.number().lt(0).describe("Lower geometric anchor (dB). Below: pass-through (gain = 1)."),
	pivot:       z.number().lt(0).describe("Upper geometric anchor (dB). At and above: full boost (gain = 1 + B)."),
	tension:     z.number().gt(0).default(1).describe("Superellipse tension on the floor → pivot ramp. (0, ∞), 1 = linear."),
	smoothing:   z.number().min(0.01).max(200).default(1).describe("Bidirectional IIR time constant (ms). Smoothing on the gain envelope."),
	tolerance:   z.number().gt(0).default(0.5).describe("Iteration exit threshold (LUFS dB)."),
	maxAttempts: z.number().int().min(1).default(10).describe("Hard cap on iteration attempts. Closest-attempt fallback if exhausted."),
}).refine(
	({ floor, pivot }) => floor < pivot,
	{ message: "loudnessExpander requires floor < pivot < 0 (dB)" },
);

export interface LoudnessExpanderProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class LoudnessExpanderStream extends BufferedTransformStream<LoudnessExpanderProperties> {
	/**
	 * Source-sized smoothed gain envelope produced by the winning
	 * iteration attempt. `_unbuffer` slices it by `chunk.offset` and
	 * multiplies it onto each channel. `null` when the stream passes
	 * through (silent / sub-floor / degenerate-anchor guard).
	 */
	private winningSmoothedEnvelope: Float32Array | null = null;

	/**
	 * Boost factor `B` chosen by the secant iteration. `null` when the
	 * stream passes through (no curve was learned). Diagnostic only —
	 * the apply pass uses the materialised envelope, not the boost
	 * directly.
	 */
	private winningBoost: number | null = null;

	/**
	 * Per-chunk wall-clock time spent in `_unbuffer` (slice + scalar
	 * multiply per chunk). Accumulated across all `_unbuffer` calls.
	 */
	public unbufferElapsedMs = 0;

	/**
	 * Wall-clock breakdown of the learn pass. Mirrors the shaper's
	 * `learnTimingMs` for QA driver parity.
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

		const { target, floor, pivot, tension, smoothing, tolerance, maxAttempts } = this.properties;

		// --- Learn pass ---
		// 1. Source integrated LUFS — single streaming walk through the
		//    buffer; constant memory. No peak tracking (the expander has
		//    no peak anchor).
		const t0 = Date.now();
		const sourceLUFS = await measureSourceLufs(buffer, sampleRate);

		this.learnTimingMs.sourceMeasurement = Date.now() - t0;

		if (!Number.isFinite(sourceLUFS)) {
			// Silent / sub-block-length signal: nothing measurable, no
			// curve to apply.
			console.log(`[loudness-expander] source has no measurable loudness (LUFS=${String(sourceLUFS)}); pass-through.`);

			return;
		}

		// 2. Convert user-supplied dB anchors to linear amplitudes.
		const floorLin = Math.pow(10, floor / 20);
		const pivotLin = Math.pow(10, pivot / 20);

		// Degenerate guard: with `pivotLin <= floorLin` the curve has no
		// rising-side range — `shapeAt` would return 0 everywhere and the
		// iteration could not produce any lift. Bail to pass-through. The
		// schema's `.refine()` already rejects `floor >= pivot` in dB, so
		// this triggers only on numerical edge cases (e.g. equal values
		// after the linearisation).
		if (pivotLin <= floorLin) {
			console.log(`[loudness-expander] degenerate anchors (floorLin=${floorLin.toExponential(3)} pivotLin=${pivotLin.toExponential(3)}); pass-through.`);

			return;
		}

		// 3. Linked detection envelope — single source-sized
		//    `Float32Array` of `max_c(|x[n, c]|)`. B-independent;
		//    computed once and reused across all iteration attempts.
		const tDetect0 = Date.now();
		const detection = await computeLinkedDetection(buffer);

		this.learnTimingMs.detection = Date.now() - tDetect0;

		// 4. Iterate to find the winning boost. Each attempt builds a
		//    fresh smoothed gain envelope; the winning one is returned by
		//    reference so the apply pass doesn't re-run the smoother.
		const tIter0 = Date.now();
		const result = await iterateForTarget({
			buffer,
			sampleRate,
			detection,
			curveParams: { floor: floorLin, pivot: pivotLin, tension },
			smoothingMs: smoothing,
			targetLUFS: target,
			sourceLUFS,
			maxAttempts,
			toleranceLUFSdB: tolerance,
		});

		this.learnTimingMs.iteration = Date.now() - tIter0;

		this.winningSmoothedEnvelope = result.bestSmoothedEnvelope;
		this.winningBoost = result.bestBoost;

		const lastAttempt = result.attempts[result.attempts.length - 1];
		const lastIterationLufs = lastAttempt?.outputLUFS;

		console.log(
			`[loudness-expander] target=${target.toFixed(2)} sourceLUFS=${sourceLUFS.toFixed(2)} ` +
				`bestBoost=${result.bestBoost.toFixed(4)} converged=${String(result.converged)} ` +
				`attempts=${String(result.attempts.length)} ` +
				`iterationLUFS=${lastIterationLufs === undefined ? "n/a" : lastIterationLufs.toFixed(2)} ` +
				`floor=${floor} pivot=${pivot} ` +
				`tension=${tension} smoothing=${smoothing} ` +
				`tolerance=${tolerance} maxAttempts=${maxAttempts}`,
		);
	}

	override _teardown(): void {
		// Print the wall-clock breakdown before the stream is destroyed
		// so the QA driver can read it from stdout. Mirrors the shaper's
		// timing summary.
		if (this.winningBoost !== null) {
			const total = this.learnTimingMs.sourceMeasurement + this.learnTimingMs.detection + this.learnTimingMs.iteration + this.unbufferElapsedMs;

			console.log(
				`[loudness-expander timing] sourceMeasurement=${this.learnTimingMs.sourceMeasurement}ms ` +
					`detection=${this.learnTimingMs.detection}ms ` +
					`iteration=${this.learnTimingMs.iteration}ms ` +
					`unbufferApply=${this.unbufferElapsedMs}ms ` +
					`total=${total}ms`,
			);
		}
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const smoothedGain = this.winningSmoothedEnvelope;

		// Pass-through when no envelope was learned (silent / sub-floor /
		// degenerate guard).
		if (smoothedGain === null) return chunk;

		const tStart = Date.now();
		const transformed = applySmoothedGainChunk({
			chunkSamples: chunk.samples,
			smoothedGain,
			offset: chunk.offset,
		});

		this.unbufferElapsedMs += Date.now() - tStart;

		return { samples: transformed, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class LoudnessExpanderNode extends TransformNode<LoudnessExpanderProperties> {
	static override readonly moduleName = "LoudnessExpander";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Single-pivot content-adaptive expander with smoothed gain envelope; lifts body density toward target LUFS via a bidirectional IIR on the gain. Sidebands-axis sibling of `loudnessShaper`.";
	static override readonly schema = schema;
	static override is(value: unknown): value is LoudnessExpanderNode {
		return TransformNode.is(value) && value.type[2] === "loudness-expander";
	}

	override readonly type = ["buffered-audio-node", "transform", "loudness-expander"] as const;

	constructor(properties: LoudnessExpanderProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): LoudnessExpanderStream {
		return new LoudnessExpanderStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<LoudnessExpanderProperties>): LoudnessExpanderNode {
		return new LoudnessExpanderNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function loudnessExpander(options: { target?: number; floor: number; pivot: number; tension?: number; smoothing?: number; tolerance?: number; maxAttempts?: number; id?: string }): LoudnessExpanderNode {
	const parsed = schema.parse(options);

	return new LoudnessExpanderNode({ ...parsed, id: options.id });
}
