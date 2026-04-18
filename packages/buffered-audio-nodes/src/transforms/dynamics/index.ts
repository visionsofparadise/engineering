import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { Oversampler, type OversamplingFactor } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import {
	makeEnvelopeState,
	makeEnvelopeCoefficients,
	smoothGainReduction,
	type EnvelopeState,
	type EnvelopeCoefficients,
} from "./utils/envelope";
import { computeGainReductionDb, dbToLinear, linearToDb, type DynamicsMode } from "./utils/gain";

export const schema = z.object({
	threshold: z.number().min(-60).max(0).multipleOf(0.1).default(-24).describe("Threshold (dBFS)"),
	ratio: z.number().min(1).max(100).multipleOf(0.1).default(4).describe("Ratio"),
	attack: z.number().min(0).max(500).multipleOf(0.1).default(10).describe("Attack (ms)"),
	release: z.number().min(0).max(5000).multipleOf(1).default(100).describe("Release (ms)"),
	knee: z.number().min(0).max(24).multipleOf(0.1).default(6).describe("Knee (dB)"),
	makeupGain: z.number().min(-24).max(24).multipleOf(0.1).default(0).describe("Makeup Gain (dB)"),
	lookahead: z.number().min(0).max(100).multipleOf(0.1).default(0).describe("Lookahead (ms)"),
	detection: z.enum(["peak", "rms"]).default("peak").describe("Detection mode"),
	mode: z.enum(["downward", "upward"]).default("downward").describe("Dynamics mode"),
	stereoLink: z.enum(["average", "max", "none"]).default("average").describe("Stereo link"),
	oversampling: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(1).describe("Oversampling factor for true-peak detection (1 = off, 2/4/8 = inter-sample peak recovery). Envelope timing is unaffected — coefficients are always at the original rate."),
});

export interface DynamicsProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Shared dynamics engine powering both CompressorNode and LimiterNode.
 *
 * Signal flow per chunk:
 * 1. Upsample each channel through its per-channel `Oversampler`. At factor 1
 *    this is a copy (no rate change); at factor 2/4/8 the inter-sample peaks
 *    between original-rate samples become visible.
 * 2. For each original frame `i`, derive a per-frame detection level from the
 *    `factor` upsampled samples in window [i*factor, i*factor + factor):
 *      - peak  → max(|upsampled[...]|) over the window (true-peak detection)
 *      - rms   → RMS over the window
 * 3. Apply stereo linking at the original rate using those per-frame levels.
 * 4. For each original frame: convert to dB, compute gain reduction, advance
 *    the envelope follower with original-rate coefficients (one tick per
 *    original frame), apply makeup gain, multiply the original-rate sample
 *    by the resulting gain and write to the output.
 * 5. No downsample — gain is smooth per-original-frame and applied to
 *    original-rate audio; no aliasing is introduced.
 *
 * Lookahead composes with oversampling cleanly: detection still runs from
 * the forward-looking (non-delayed) input, and the resulting gain is
 * applied to the delayed sample read from the lookahead circular buffer.
 *
 * State is per-stream (fresh per render), maintained across chunks.
 */
export class DynamicsStream extends BufferedTransformStream<DynamicsProperties> {
	private envelopeStates: Array<EnvelopeState> = [];
	private coefficients: EnvelopeCoefficients | null = null;
	private makeupLinear = 1;

	/** Circular delay buffer per channel for lookahead. Null when disabled. */
	private lookaheadBuffers: Array<Float32Array> | null = null;
	private lookaheadLength = 0;
	private lookaheadWritePos = 0;

	/**
	 * Per-channel oversamplers — always allocated, one per channel. Factor 1
	 * is a valid pass-through (no rate change, no LP filtering). The
	 * Oversampler's `factor` property is the source of truth for the window
	 * size used by per-frame detection.
	 */
	private oversamplers: Array<Oversampler> = [];

	private sampleRateKnown = false;

	private ensureState(channels: number, sampleRate: number): void {
		if (this.sampleRateKnown && this.envelopeStates.length === channels) return;

		this.sampleRateKnown = true;

		const { attack, release, makeupGain, lookahead, oversampling } = this.properties;

		this.envelopeStates = Array.from({ length: channels }, () => makeEnvelopeState());
		this.coefficients = makeEnvelopeCoefficients(attack, release, sampleRate);
		this.makeupLinear = dbToLinear(makeupGain);

		if (lookahead > 0) {
			this.lookaheadLength = Math.max(1, Math.round((lookahead / 1000) * sampleRate));
			this.lookaheadBuffers = Array.from({ length: channels }, () => new Float32Array(this.lookaheadLength));
			this.lookaheadWritePos = 0;
		} else {
			this.lookaheadBuffers = null;
			this.lookaheadLength = 0;
		}

		// Oversamplers are always allocated, regardless of factor. Factor 1 is
		// a valid pass-through — `upsample()` simply returns a copy of the
		// input, so the same code path handles oversampled and non-oversampled
		// cases uniformly.
		const factor = oversampling as OversamplingFactor;

		this.oversamplers = Array.from({ length: channels }, () => new Oversampler(factor, sampleRate));
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { samples, sampleRate } = chunk;

		if (samples.length === 0) return chunk;

		const channels = samples.length;

		this.ensureState(channels, sampleRate);

		const coefficients = this.coefficients;

		if (!coefficients) return chunk;

		const { threshold, ratio, knee, mode, detection, stereoLink } = this.properties;
		const frames = samples[0]?.length ?? 0;

		if (frames === 0) return chunk;

		const outputSamples: Array<Float32Array> = samples.map((ch) => new Float32Array(ch.length));

		// Step 1: upsample each channel through its oversampler. At factor 1
		// this is a copy; at factor > 1 it reveals inter-sample peaks.
		const upsampledPerChannel = new Array<Float32Array>(channels);
		const factors = new Array<number>(channels);

		for (let ch = 0; ch < channels; ch++) {
			const oversampler = this.oversamplers[ch];
			const inCh = samples[ch];

			if (!oversampler || !inCh) {
				upsampledPerChannel[ch] = new Float32Array(0);
				factors[ch] = 1;

				continue;
			}

			upsampledPerChannel[ch] = oversampler.upsample(inCh);
			factors[ch] = oversampler.factor;
		}

		// Step 2: per-frame per-channel detection from the factor-sized window
		// of upsampled samples. RMS vs peak is computed over that window:
		//   - peak: max(|x|) over the window — true-peak detection, recovers
		//           inter-sample peaks at factor > 1.
		//   - rms:  sqrt(mean(x^2)) over the window. At factor 1 this is |x|,
		//           identical to peak for a 1-sample window — documented
		//           tradeoff; RMS is largely insensitive to inter-sample peaks
		//           anyway.
		const perChannelLevels: Array<Float32Array> = Array.from({ length: channels }, () => new Float32Array(frames));

		for (let ch = 0; ch < channels; ch++) {
			const upsampled = upsampledPerChannel[ch];
			const factor = factors[ch] ?? 1;
			const levels = perChannelLevels[ch];

			if (!upsampled || !levels) continue;

			for (let index = 0; index < frames; index++) {
				const baseIdx = index * factor;
				let value = 0;

				if (detection === "peak") {
					for (let offset = 0; offset < factor; offset++) {
						const abs = Math.abs(upsampled[baseIdx + offset] ?? 0);

						if (abs > value) value = abs;
					}
				} else {
					// rms over the factor-sized window
					let sumSq = 0;

					for (let offset = 0; offset < factor; offset++) {
						const sample = upsampled[baseIdx + offset] ?? 0;

						sumSq += sample * sample;
					}

					value = Math.sqrt(sumSq / factor);
				}

				levels[index] = value;
			}
		}

		// Step 3: stereo linking per frame (across channels) using the
		// detected per-channel levels. Linking always happens at the original
		// rate — it requires access to all channels at the same frame.
		const linkedLevelsPerChannel: Array<Float32Array> = Array.from({ length: channels }, () => new Float32Array(frames));

		for (let index = 0; index < frames; index++) {
			// Build a single-frame per-channel view (already-detected level)
			// that we can hand to detectLevels — but detectLevels operates on
			// raw samples, so instead do the linking inline here using the
			// level values already computed above.
			let linked: number;

			if (stereoLink === "none") {
				for (let ch = 0; ch < channels; ch++) {
					const levels = perChannelLevels[ch];
					const linkedLevels = linkedLevelsPerChannel[ch];

					if (levels && linkedLevels) linkedLevels[index] = levels[index] ?? 0;
				}

				continue;
			}

			if (stereoLink === "average") {
				let total = 0;

				for (let ch = 0; ch < channels; ch++) {
					total += perChannelLevels[ch]?.[index] ?? 0;
				}

				linked = total / channels;
			} else {
				// max
				linked = 0;

				for (let ch = 0; ch < channels; ch++) {
					const value = perChannelLevels[ch]?.[index] ?? 0;

					if (value > linked) linked = value;
				}
			}

			for (let ch = 0; ch < channels; ch++) {
				const linkedLevels = linkedLevelsPerChannel[ch];

				if (linkedLevels) linkedLevels[index] = linked;
			}
		}

		// Step 4: per-frame gain computation and application. Envelope
		// advances at the original rate with original-rate coefficients
		// (one tick per original frame) — this keeps attack/release timing
		// invariant under oversampling.
		if (this.lookaheadBuffers) {
			// Lookahead branch: detection is computed above from the forward
			// (non-delayed) input. Gain is applied to the delayed sample read
			// from the circular lookahead buffer.
			const lookaheadBufs = this.lookaheadBuffers;
			const lookaheadLen = this.lookaheadLength;

			for (let ch = 0; ch < channels; ch++) {
				const state = this.envelopeStates[ch];
				const inCh = samples[ch];
				const outCh = outputSamples[ch];
				const linkedLevels = linkedLevelsPerChannel[ch];
				const lookaheadBuf = lookaheadBufs[ch];

				if (!state || !inCh || !outCh || !linkedLevels || !lookaheadBuf) continue;

				let writePos = this.lookaheadWritePos;

				for (let index = 0; index < frames; index++) {
					const level = linkedLevels[index] ?? 0;
					const levelDb = linearToDb(level);
					const reductionDb = computeGainReductionDb(levelDb, threshold, ratio, knee, mode as DynamicsMode);
					const smoothed = smoothGainReduction(reductionDb, state, coefficients);
					const gain = dbToLinear(smoothed) * this.makeupLinear;

					const delayed = lookaheadBuf[writePos] ?? 0;

					lookaheadBuf[writePos] = inCh[index] ?? 0;
					outCh[index] = delayed * gain;
					writePos = (writePos + 1) % lookaheadLen;
				}

				if (ch === channels - 1) this.lookaheadWritePos = writePos;
			}
		} else {
			// No-lookahead branch: gain applied directly to the current
			// original-rate sample.
			for (let ch = 0; ch < channels; ch++) {
				const state = this.envelopeStates[ch];
				const inCh = samples[ch];
				const outCh = outputSamples[ch];
				const linkedLevels = linkedLevelsPerChannel[ch];

				if (!state || !inCh || !outCh || !linkedLevels) continue;

				for (let index = 0; index < frames; index++) {
					const level = linkedLevels[index] ?? 0;
					const levelDb = linearToDb(level);
					const reductionDb = computeGainReductionDb(levelDb, threshold, ratio, knee, mode as DynamicsMode);
					const smoothed = smoothGainReduction(reductionDb, state, coefficients);
					const gain = dbToLinear(smoothed) * this.makeupLinear;

					outCh[index] = (inCh[index] ?? 0) * gain;
				}
			}
		}

		return { samples: outputSamples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class DynamicsNode extends TransformNode<DynamicsProperties> {
	static override readonly moduleName = "Dynamics";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Full-featured dynamics processor — compress or expand audio";
	static override readonly schema = schema;
	static override is(value: unknown): value is DynamicsNode {
		return TransformNode.is(value) && value.type[2] === "dynamics";
	}

	override readonly type = ["buffered-audio-node", "transform", "dynamics"] as const;

	override createStream(): DynamicsStream {
		return new DynamicsStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DynamicsProperties>): DynamicsNode {
		return new DynamicsNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function dynamics(options?: Partial<DynamicsProperties> & { id?: string }): DynamicsNode {
	const parsed = schema.parse(options ?? {});

	return new DynamicsNode({ ...parsed, id: options?.id });
}
