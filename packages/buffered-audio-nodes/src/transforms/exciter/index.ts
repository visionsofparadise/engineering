import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { highPassCoefficients, Oversampler, type OversamplingFactor } from "@e9g/buffered-audio-nodes-utils";
import type { BiquadCoefficients } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { applyShaper, type ExciterMode } from "./utils/shapers";
import { makeFilterState, processSample, type BandFilterState } from "../eq/utils/band-filter";

export const schema = z.object({
	mode: z.enum(["soft", "tube", "fold"]).default("soft").describe("Saturation mode"),
	frequency: z.number().min(20).max(20000).multipleOf(1).default(3000).describe("Crossover frequency (Hz)"),
	drive: z.number().min(0).max(24).multipleOf(0.1).default(6).describe("Drive (dB)"),
	mix: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Wet/dry mix (0 = dry, 1 = wet)"),
	harmonics: z.number().min(0.5).max(2).multipleOf(0.01).default(1).describe("Harmonic emphasis multiplier"),
	oversampling: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).default(2).describe("Oversampling factor (1 = off, 2/4/8 = internal-rate multiplier for alias-free nonlinear processing)"),
});

export interface ExciterProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Harmonic Exciter.
 *
 * Signal flow per chunk:
 * 1. Band isolation: high-pass filter above `frequency` to isolate the
 *    excitation band.
 * 2. Drive: apply `drive` dB gain to the isolated band.
 * 3. Transfer curve: apply the nonlinear shaper via `Oversampler.oversample`,
 *    which at factor > 1 upsamples, applies the shaper, and downsamples to
 *    reduce aliasing from the generated harmonics. At factor 1 the
 *    oversampler is still used — `oversample()` just maps the shaper over
 *    the driven band at the original rate (see `Oversampler` docs).
 * 4. Harmonics: scale the shaper output by `harmonics`.
 * 5. Wet/dry: mix shaped signal back with the original dry signal.
 *
 * The high-pass filter state and oversampler state are maintained across
 * chunks to prevent discontinuities at chunk boundaries.
 */
export class ExciterStream extends BufferedTransformStream<ExciterProperties> {
	/** Per-channel high-pass biquad state for band isolation. */
	private hpStates: Array<BandFilterState> = [];
	private hpCoefficients: BiquadCoefficients | null = null;

	/** Per-channel oversamplers for the shaper stage. Always allocated; factor=1 is a valid pass-through. */
	private oversamplers: Array<Oversampler> = [];

	private sampleRateKnown = false;

	private ensureState(channels: number, sampleRate: number): void {
		if (this.sampleRateKnown && this.hpStates.length === channels) return;

		this.sampleRateKnown = true;

		const { frequency, oversampling } = this.properties;

		// Standard Q=0.71 (Butterworth) for a clean crossover
		this.hpCoefficients = highPassCoefficients(sampleRate, frequency, 0.71);
		this.hpStates = Array.from({ length: channels }, () => makeFilterState());

		// Oversampler is always allocated — factor 1 is a valid pass-through.
		const factor = oversampling as OversamplingFactor;

		this.oversamplers = Array.from({ length: channels }, () => new Oversampler(factor, sampleRate));
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { samples, sampleRate } = chunk;

		if (samples.length === 0) return chunk;

		const channels = samples.length;

		this.ensureState(channels, sampleRate);

		const hpCoeffs = this.hpCoefficients;

		if (!hpCoeffs) return chunk;

		const { mode, drive, mix, harmonics } = this.properties;
		const driveLinear = Math.pow(10, drive / 20);
		const dryMix = 1 - mix;
		const shaperFn = (x: number): number => applyShaper(x, mode as ExciterMode);

		const outputSamples: Array<Float32Array> = samples.map((inCh, ch) => {
			const frames = inCh.length;
			const outCh = new Float32Array(frames);
			const hpState = this.hpStates[ch];
			const oversampler = this.oversamplers[ch];

			if (!hpState || !oversampler) {
				outCh.set(inCh);

				return outCh;
			}

			// Step 1 + 2: Band isolation and drive — build the driven band signal
			// at original sample rate first. The high-pass filter is stateful and
			// must run at the original rate to preserve its chunk-continuous state.
			const drivenBand = new Float32Array(frames);

			for (let index = 0; index < frames; index++) {
				const drySample = inCh[index] ?? 0;
				const bandSample = processSample(drySample, hpCoeffs, hpState);

				drivenBand[index] = bandSample * driveLinear;
			}

			// Step 3: Shaper through the oversampler. At factor > 1 this
			// upsamples, shapes, and downsamples; at factor 1 it maps the shaper
			// over the driven band at the original rate.
			const shaped = oversampler.oversample(drivenBand, shaperFn);

			// Steps 4 + 5: Harmonics and wet/dry mix at original rate.
			for (let index = 0; index < frames; index++) {
				const drySample = inCh[index] ?? 0;
				const emphasized = (shaped[index] ?? 0) * harmonics;

				outCh[index] = drySample * dryMix + emphasized * mix;
			}

			return outCh;
		});

		return { samples: outputSamples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class ExciterNode extends TransformNode<ExciterProperties> {
	static override readonly moduleName = "Exciter";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Harmonic exciter — adds upper-harmonic content via band-limited saturation";
	static override readonly schema = schema;
	static override is(value: unknown): value is ExciterNode {
		return TransformNode.is(value) && value.type[2] === "exciter";
	}

	override readonly type = ["buffered-audio-node", "transform", "exciter"] as const;

	override createStream(): ExciterStream {
		return new ExciterStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<ExciterProperties>): ExciterNode {
		return new ExciterNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function exciter(options?: Partial<ExciterProperties> & { id?: string }): ExciterNode {
	const parsed = schema.parse(options ?? {});

	return new ExciterNode({ ...parsed, id: options?.id });
}
