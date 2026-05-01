import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator, Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import type { CurveParams } from "./utils/curve";
import { iterateForTarget } from "./utils/iterate";
import { buildLUT, lookupLUT, type LUT } from "./utils/lut";
import { measureIntegratedLufs } from "./utils/measurement";

/**
 * Default histogram bucket count. Per plan §1.3 / §5.2 default — 1024
 * gives ~10-bit linear amplitude resolution, plenty for median /
 * bucket-max anchoring, well below the per-stream memory budget.
 */
const DEFAULT_BUCKET_COUNT = 1024;

/**
 * Default LUT point count target. Per plan §2.2 / §5.2 default — 512
 * cosine-spaced points per side meets the < 0.001 round-trip tolerance
 * across `density ∈ [0.5, 5]` (Phase 2 verification).
 */
const DEFAULT_POINT_COUNT_TARGET = 512;

/**
 * Streaming chunk size for the learn pass's two-pass histogram and the
 * source-LUFS measurement. Matches `iterate.ts` and
 * `loudness-normalize/utils/measurement.ts`.
 */
const CHUNK_FRAMES = 44100;

/**
 * Oversampling factor for the streaming apply pass. Matches the design
 * doc's 4×; keep in sync with `apply-final.ts`'s `DEFAULT_FACTOR`.
 */
const OVERSAMPLE_FACTOR = 4;

/**
 * Sentinel default for `floor` (dB). `-1000` dB is `10^-50` linear —
 * far below any meaningful audio sample, including 32-bit-float
 * denormal-ish noise. Default-on-but-effectively-off: every code site
 * gates against `floorLinear` unconditionally, but at the default no
 * sample fails the comparison so behaviour is unchanged from the
 * pre-floor implementation. Round-trips cleanly through JSON for
 * `.bag` graph configs (unlike `-Infinity` which JSON serialises as
 * `null` and Zod rejects).
 */
const FLOOR_DEFAULT_DB = -1000;

export const schema = z.object({
	target: z.number().min(-50).max(0).multipleOf(0.1).default(-16).describe("Target integrated loudness (LUFS)"),
	density: z.number().positive().default(1).describe("Density (curve power exponent)"),
	warmth: z.number().min(0).max(1).default(0).describe("Warmth (positive/negative-half asymmetry)"),
	floor: z.number().max(0).default(FLOOR_DEFAULT_DB).describe("Floor (dB) below which samples are excluded from stats and processing"),
});

export interface LoudnessCurveProperties extends z.infer<typeof schema>, TransformNodeProperties {}

interface AmplitudeHistogramSnapshot {
	bucketMax: number;
	median: number;
}

export class LoudnessCurveStream extends BufferedTransformStream<LoudnessCurveProperties> {
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
	 * Linear-amplitude floor below which samples are excluded from
	 * histogram stats and bypassed (pass-through) at apply time.
	 * Computed from the `floor` (dB) property in `_process`; consumed
	 * per-sample in `_unbuffer`. At the schema default of `-1000` dB
	 * this is ~`1e-50`, smaller than any representable sample, so the
	 * gate never trips.
	 */
	private floorLinear = 0;

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channelCount = buffer.channels;
		const sampleRate = buffer.sampleRate ?? this.sampleRate ?? 44100;

		if (frames === 0 || channelCount === 0) return;

		const { target, density, warmth, floor } = this.properties;
		const floorLinear = Math.pow(10, floor / 20);

		this.floorLinear = floorLinear;

		// --- Learn pass ---
		// 1. Source integrated LUFS — streamed, constant memory. NOT
		//    gated by `floor`: BS.1770 has its own gating, and the
		//    user-stipulated semantic for the floor parameter is "stats
		//    and processing" (= histogram + LUT apply), not LUFS
		//    measurement. Source / iteration / final-apply LUFS all
		//    measure the whole signal.
		const sourceLUFS = await measureIntegratedLufs(buffer, sampleRate);

		if (!Number.isFinite(sourceLUFS)) {
			// Silent / sub-block-length signal: nothing measurable, no curve to apply.
			// Leave winningLut null; _unbuffer will pass chunks through unchanged.
			console.log(`[loudness-curve] source has no measurable loudness (LUFS=${String(sourceLUFS)}); pass-through.`);

			return;
		}

		// 2. Streaming histograms. Two-pass per-side: pass 1 finds the
		//    bucketMax, pass 2 fills the buckets and computes the median.
		//    Combined |x| histogram covers the positive side at any warmth;
		//    negative-only histogram is computed only when warmth > 0.
		const positiveHistogram = await streamingAmplitudeHistogram(buffer, DEFAULT_BUCKET_COUNT, "absolute", chunkFramesFor(sampleRate), floorLinear);
		const negativeHistogram = warmth > 0
			? await streamingAmplitudeHistogram(buffer, DEFAULT_BUCKET_COUNT, "negative-only", chunkFramesFor(sampleRate), floorLinear)
			: positiveHistogram;

		const posParams = paramsFromHistogram(positiveHistogram, density, warmth);
		const negParams = paramsFromHistogram(negativeHistogram, density, warmth);

		// Histograms with no measurable spread (max = 0) cannot anchor a curve.
		// Leave winningLut null — _unbuffer will pass chunks through unchanged.
		if (posParams.max <= 0 || negParams.max <= 0) {
			console.log(`[loudness-curve] degenerate histogram (posMax=${String(posParams.max)}, negMax=${String(negParams.max)}); pass-through.`);

			return;
		}

		// 3. Iterate to find the winning boost. Each attempt re-walks the
		//    buffer via `buffer.iterate` and applies the LUT chunk-by-chunk
		//    into a per-channel scratch buffer.
		const result = await iterateForTarget({
			buffer,
			sampleRate,
			posParams,
			negParams,
			targetLUFS: target,
			sourceLUFS,
			floorLinear,
			pointCountTarget: DEFAULT_POINT_COUNT_TARGET,
			chunkFrames: chunkFramesFor(sampleRate),
		});

		// 4. Build the winning LUT and stand up the per-channel oversamplers
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
			`[loudness-curve] target=${target.toFixed(2)} sourceLUFS=${sourceLUFS.toFixed(2)} ` +
				`bestBoost=${result.bestBoost.toFixed(4)} converged=${String(result.converged)} ` +
				`attempts=${String(result.attempts.length)} ` +
				`iterationLUFS=${lastIterationLufs === undefined ? "n/a" : lastIterationLufs.toFixed(2)} ` +
				`density=${density} warmth=${warmth} floor=${floor}`,
		);
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const lut = this.winningLut;

		if (lut === null) return chunk;

		const oversamplers = this.oversamplers;
		const floorLinear = this.floorLinear;
		const transformed: Array<Float32Array> = chunk.samples.map((channel, channelIndex) => {
			const oversampler = oversamplers[channelIndex];

			if (oversampler === undefined || channel.length === 0) {
				// No oversampler for this channel (shouldn't happen — the
				// learn pass allocates one per channel) or empty input.
				// Pass through unchanged.
				return channel;
			}

			// Gate inside the oversample callback at the upsampled rate:
			// below-floor samples pass through, above-floor samples go
			// through the LUT. At the schema default (`floor = -1000` dB,
			// `floorLinear ≈ 1e-50`) the gate never trips and behaviour
			// matches the pre-floor implementation exactly.
			return oversampler.oversample(channel, (sample) =>
				(sample < 0 ? -sample : sample) < floorLinear ? sample : lookupLUT(lut, sample),
			);
		});

		return { samples: transformed, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class LoudnessCurveNode extends TransformNode<LoudnessCurveProperties> {
	static override readonly moduleName = "LoudnessCurve";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Content-adaptive amplitude transfer curve that lifts the body of the histogram toward a target LUFS — body-density gain without limiting";
	static override readonly schema = schema;
	static override is(value: unknown): value is LoudnessCurveNode {
		return TransformNode.is(value) && value.type[2] === "loudness-curve";
	}

	override readonly type = ["buffered-audio-node", "transform", "loudness-curve"] as const;

	constructor(properties: LoudnessCurveProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): LoudnessCurveStream {
		return new LoudnessCurveStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<LoudnessCurveProperties>): LoudnessCurveNode {
		return new LoudnessCurveNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function loudnessCurve(options?: { target?: number; density?: number; warmth?: number; floor?: number; id?: string }): LoudnessCurveNode {
	const parsed = schema.parse(options ?? {});

	return new LoudnessCurveNode({ ...parsed, id: options?.id });
}

/**
 * Build a `CurveParams` from a histogram snapshot plus the user-facing
 * density / warmth. The same `warmth` value is carried on both
 * `posParams` and `negParams` (per `curve.ts` documentation: only the
 * negative-side shape uses warmth, but both halves carry the global
 * setting so callers can pass either object as the source of truth).
 */
function paramsFromHistogram(histogram: AmplitudeHistogramSnapshot, density: number, warmth: number): CurveParams {
	return {
		median: histogram.median,
		max: histogram.bucketMax,
		density,
		warmth,
	};
}

/**
 * Choose the streaming chunk size for the learn pass. The default
 * `CHUNK_FRAMES` (= 44100) is one second at 44.1 kHz; at 48 kHz it's
 * still ~0.92 s — close enough that we keep the constant rather than
 * introducing per-rate scaling that would diverge from
 * `loudness-normalize/utils/measurement.ts`.
 *
 * `sampleRate` is unused today; the parameter is retained as the seam
 * for a future per-rate scaling decision without a signature churn.
 */
function chunkFramesFor(_sampleRate: number): number {
	return CHUNK_FRAMES;
}

/**
 * Streaming amplitude-histogram primitive — two-pass over a
 * `ChunkBuffer`. Pass 1 walks the buffer to find the running max; pass
 * 2 walks again to fill the buckets and compute the linear-interpolated
 * median. Returns only the snapshot fields the curve geometry needs
 * (`bucketMax`, `median`), not the full bucket array — the bucket data
 * is only useful within the median computation.
 *
 * `mode = "absolute"` accumulates `|x|` for every sample (matches the
 * in-memory `amplitudeHistogram` primitive). `mode = "negative-only"`
 * accumulates `|x|` only when `x < 0` and the median's denominator is
 * the count of negative samples (not total samples). This is the
 * compact-array semantic the prior in-memory `computeNegativeHistogram`
 * implemented; we recreate it here so we never have to allocate a
 * full-buffer compact array.
 *
 * `floorLinear` excludes samples with `|x| < floorLinear` from both
 * passes — they don't contribute to `bucketMax`, the bucket counts, or
 * the median's denominator. Used to keep voice-with-silence sources
 * from collapsing the median toward zero. Default `0` (no gating);
 * the schema sentinel `floor = -1000` dB resolves to `floorLinear ≈
 * 1e-50`, so the gate never trips for any representable sample.
 *
 * Constant memory in source duration: holds only one chunk plus the
 * `bucketCount`-sized `Uint32Array` and a handful of scalars.
 *
 * Exported so unit tests can exercise the streaming path directly
 * against a `MemoryChunkBuffer`.
 */
export async function streamingAmplitudeHistogram(
	buffer: ChunkBuffer,
	bucketCount: number,
	mode: "absolute" | "negative-only",
	chunkFrames: number,
	floorLinear = 0,
): Promise<AmplitudeHistogramSnapshot> {
	if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
		throw new Error(`streamingAmplitudeHistogram: bucketCount must be a positive integer, got ${String(bucketCount)}`);
	}

	if (buffer.frames === 0 || buffer.channels === 0) {
		return { bucketMax: 0, median: 0 };
	}

	// Pass 1: running max and total contributing-sample count.
	let bucketMax = 0;
	let totalSamples = 0;

	for await (const chunk of buffer.iterate(chunkFrames)) {
		const channels = chunk.samples;

		for (const channel of channels) {
			const length = channel.length;

			for (let index = 0; index < length; index++) {
				const sample = channel[index] ?? 0;

				if (mode === "absolute") {
					const absolute = sample < 0 ? -sample : sample;

					if (absolute < floorLinear) continue;

					if (absolute > bucketMax) bucketMax = absolute;
					totalSamples++;
				} else if (sample < 0) {
					const absolute = -sample;

					if (absolute < floorLinear) continue;

					if (absolute > bucketMax) bucketMax = absolute;
					totalSamples++;
				}
			}
		}
	}

	if (totalSamples === 0 || bucketMax === 0) {
		return { bucketMax: 0, median: 0 };
	}

	// Pass 2: bucket the contributing samples.
	const buckets = new Uint32Array(bucketCount);
	const scale = bucketCount / bucketMax;
	const lastBucket = bucketCount - 1;

	for await (const chunk of buffer.iterate(chunkFrames)) {
		const channels = chunk.samples;

		for (const channel of channels) {
			const length = channel.length;

			for (let index = 0; index < length; index++) {
				const sample = channel[index] ?? 0;

				let absolute: number;

				if (mode === "absolute") {
					absolute = sample < 0 ? -sample : sample;
				} else {
					if (sample >= 0) continue;

					absolute = -sample;
				}

				if (absolute < floorLinear) continue;

				let bucketIndex = Math.floor(absolute * scale);

				if (bucketIndex < 0) bucketIndex = 0;
				else if (bucketIndex > lastBucket) bucketIndex = lastBucket;

				buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + 1;
			}
		}
	}

	// Linear-interpolated median over the contributing-sample count.
	// Identical algorithm to `amplitudeHistogram` — the only difference
	// is that `totalSamples` is the count of contributing samples, not
	// the buffer's total sample count.
	const target = totalSamples / 2;
	const bucketWidth = bucketMax / bucketCount;
	let cumulative = 0;
	let median = 0;

	for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
		const count = buckets[bucketIndex] ?? 0;
		const next = cumulative + count;

		if (next >= target) {
			const fraction = count > 0 ? (target - cumulative) / count : 0;

			median = (bucketIndex + fraction) * bucketWidth;
			break;
		}

		cumulative = next;
	}

	return { bucketMax, median };
}

/**
 * Whole-buffer integrated-LUFS measurement, retained for callers that
 * have already materialised per-channel arrays in memory (e.g.
 * external validation harnesses, the unit tests' end-to-end path).
 * The node itself uses `measureIntegratedLufs` from `utils/measurement`
 * to keep memory constant in source duration.
 *
 * Returns `-Infinity` for silent / sub-block-length signals.
 *
 * Exported for the package's existing test surface; not used by the
 * node.
 */
export function measureLufsFromChannels(channels: ReadonlyArray<Float32Array>, sampleRate: number): number {
	const channelCount = channels.length;

	if (channelCount === 0) return -Infinity;

	const frames = channels[0]?.length ?? 0;

	if (frames === 0) return -Infinity;

	const accumulator = new IntegratedLufsAccumulator(sampleRate, channelCount);

	accumulator.push(channels, frames);

	return accumulator.finalize();
}
