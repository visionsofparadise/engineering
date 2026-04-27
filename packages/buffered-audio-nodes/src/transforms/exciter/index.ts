import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { highPassCoefficients, lowPassCoefficients, Oversampler, type OversamplingFactor } from "@e9g/buffered-audio-nodes-utils";
import type { BiquadCoefficients } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import type { ExciterMode } from "./utils/shapers";
import { makeAdaaCallback, type AdaaCallback } from "./utils/adaa";
import { makeFilterState, processSample, type BandFilterState } from "../eq/utils/band-filter";

/**
 * Tape-mode HF rolloff cutoff (Hz). Applied only when `mode === "tape"`, after
 * the shaper, to emulate the characteristic tape frequency response in which
 * content above ~12 kHz falls off before saturation-generated HF harmonics
 * become harsh. Q = Butterworth (0.71) for a clean single-stage rolloff.
 */
const TAPE_HF_CUTOFF_HZ = 12000;

export const schema = z.object({
	mode: z.enum(["soft", "tube", "fold", "tape"]).default("soft").describe("Saturation mode"),
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

	/**
	 * Per-channel low-pass biquad state for tape-mode HF rolloff. Applied only
	 * when `mode === "tape"` to the shaped output, emulating the
	 * characteristic tape HF response. State persists across chunks to keep
	 * the filter continuous at chunk boundaries; it is reset whenever
	 * `ensureState` re-initializes (e.g. channel count or sample rate change).
	 */
	private tapeLpStates: Array<BandFilterState> = [];
	private tapeLpCoefficients: BiquadCoefficients | null = null;

	/** Per-channel oversamplers for the shaper stage. Always allocated; factor=1 is a valid pass-through. */
	private oversamplers: Array<Oversampler> = [];

	/**
	 * Per-channel stateful ADAA callbacks. Each callback carries its own
	 * previous-sample register across chunk boundaries, so the first sample
	 * of a new chunk sees the last sample of the previous chunk as its
	 * `x_{n-1}` (Parker-Zavalishin 2016 Eq. 9). Allocated alongside
	 * `oversamplers` in `ensureState`; reset on channel-count or
	 * sample-rate change. On `mode` change we call `setMode` on each
	 * callback so the dispatch swaps without resetting the `x_{n-1}`
	 * register — see `AdaaCallback` docs for why resetting the register
	 * would introduce a spurious discontinuity.
	 */
	private adaaCallbacks: Array<AdaaCallback> = [];
	private adaaCallbackMode: ExciterMode | null = null;

	/**
	 * Per-channel dry-path delay line for latency compensation against the
	 * ADAA rule. Parker-Zavalishin 2016 §4 Eq. 17 shows that first-order
	 * ADAA with the rectangular kernel behaves as a half-sample fractional
	 * delay at low signal levels — half a sample **at the ADAA-input rate**,
	 * which is the oversampled rate. After the oversampler downsamples by
	 * factor `F`, the source-rate group delay is `0.5 / F` samples.
	 *
	 * The best integer-sample compensation is therefore `round(0.5 / F)`:
	 *   - `F = 1`: 0.5 source-rate samples → compensate with 1 sample
	 *     (over-shift by 0.5; residual comb notch at fs/2 = Nyquist, above
	 *     the audible band).
	 *   - `F ≥ 2`: ≤ 0.25 source-rate samples → compensate with 0 samples
	 *     (the residual fractional-sample lag is well below comb-filter
	 *     audibility; adding a whole-sample dry delay would over-shift to
	 *     ~0.75 samples and move the comb notch *into* the audible band).
	 *
	 * `dryDelayEnabled` records which regime we are in; at `F = 1` we run
	 * the one-sample delay per channel, at `F ≥ 2` the dry path is
	 * undelayed. A half-sample allpass would be closer to ideal at `F = 1`
	 * but costs a stateful biquad, adds its own phase non-linearity across
	 * the audio band, and is not sample-accurate at chunk boundaries
	 * without extra state plumbing — the Nyquist-centred residual comb at
	 * `F = 1` is an acceptable trade.
	 */
	private dryDelaySamples: Array<number> = [];
	private dryDelayEnabled = false;

	private sampleRateKnown = false;

	private ensureState(channels: number, sampleRate: number): void {
		if (this.sampleRateKnown && this.hpStates.length === channels) return;

		this.sampleRateKnown = true;

		const { frequency, oversampling, mode } = this.properties;
		const exciterMode = mode as ExciterMode;

		// Standard Q=0.71 (Butterworth) for a clean crossover
		this.hpCoefficients = highPassCoefficients(sampleRate, frequency, 0.71);
		this.hpStates = Array.from({ length: channels }, () => makeFilterState());

		// Tape-mode HF rolloff. Cutoff is clamped below Nyquist so the
		// coefficients remain well-defined at lower sample rates.
		const tapeCutoff = Math.min(TAPE_HF_CUTOFF_HZ, sampleRate * 0.45);

		this.tapeLpCoefficients = lowPassCoefficients(sampleRate, tapeCutoff, 0.71);
		this.tapeLpStates = Array.from({ length: channels }, () => makeFilterState());

		// Oversampler is always allocated — factor 1 is a valid pass-through.
		const factor = oversampling as OversamplingFactor;

		this.oversamplers = Array.from({ length: channels }, () => new Oversampler(factor, sampleRate));

		// Per-channel ADAA callbacks with their own x_{n-1} register.
		this.adaaCallbacks = Array.from({ length: channels }, () => makeAdaaCallback(exciterMode));
		this.adaaCallbackMode = exciterMode;

		// Dry-path delay register: one sample per channel, initialised to 0.
		// Only applied at factor=1 (see `dryDelaySamples` docblock for the
		// per-factor rationale). At factor≥2 the source-rate ADAA lag is
		// ≤ 0.25 samples, which `round(0.5/F) = 0` rounds away — no dry
		// delay is the best integer-sample approximation.
		this.dryDelaySamples = Array.from({ length: channels }, () => 0);
		this.dryDelayEnabled = factor === 1;
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
		const exciterMode = mode as ExciterMode;
		const tapeLpCoeffs = this.tapeLpCoefficients;

		// If the mode changed since the last chunk, swap the dispatch curve on
		// each ADAA callback without touching its `x_{n-1}` register (and
		// without touching `dryDelaySamples`). The previous input sample is
		// still a valid reference for the new F0 — the only discontinuity is
		// which F0 it is passed through. Resetting `x_{n-1}` to 0 would make
		// the first post-switch sample evaluate as
		// `(F0_new(x_n) − F0_new(0)) / x_n` instead of the smooth
		// `(F0_new(x_n) − F0_new(x_{n-1})) / (x_n − x_{n-1})`, which is its
		// own spurious transient; resetting only `adaaCallbacks` and leaving
		// `dryDelaySamples` also pairs a fresh-zero wet path against a stale
		// pre-switch dry sample (a one-sample glitch).
		if (this.adaaCallbackMode !== exciterMode) {
			for (const callback of this.adaaCallbacks) callback.setMode(exciterMode);
			this.adaaCallbackMode = exciterMode;
		}

		const outputSamples: Array<Float32Array> = samples.map((inCh, ch) => {
			const frames = inCh.length;
			const outCh = new Float32Array(frames);
			const hpState = this.hpStates[ch];
			const oversampler = this.oversamplers[ch];
			const adaaCallback = this.adaaCallbacks[ch];

			if (!hpState || !oversampler || !adaaCallback) {
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

			// Step 3: ADAA shaper through the oversampler. The oversampler
			// upsamples (if factor > 1), applies the stateful ADAA callback
			// per oversampled sample, and downsamples. The ADAA callback is a
			// closure over a per-channel x_{n-1} register; its state persists
			// across oversample() calls, so chunk boundaries are seamless
			// (first sample of new chunk sees last sample of previous chunk
			// as x_{n-1}). At factor=1 the oversampler passes through and the
			// callback runs at the source rate.
			const shaped = oversampler.oversample(drivenBand, adaaCallback);

			// Step 3b (tape only): HF rolloff above the saturation knee. A single
			// biquad LP (~12 kHz cutoff) applied at the original rate to the
			// shaped output — this gives tape mode its characteristic darker
			// top-end and tames the 2nd-harmonic HF that biased-tanh generates.
			// State is per-channel and persists across chunks.
			if (exciterMode === "tape" && tapeLpCoeffs) {
				const tapeLpState = this.tapeLpStates[ch];

				if (tapeLpState) {
					for (let index = 0; index < frames; index++) {
						shaped[index] = processSample(shaped[index] ?? 0, tapeLpCoeffs, tapeLpState);
					}
				}
			}

			// Steps 4 + 5: Harmonics and wet/dry mix at original rate.
			//
			// Per-factor dry-path latency compensation (Parker-Zavalishin §4
			// Eq. 17): source-rate ADAA lag is `0.5 / factor` samples. At
			// factor=1 we one-sample-delay the dry path (the best integer
			// rounding of a 0.5-sample lag; residual half-sample comb notch
			// lands at fs/2, above the audible band). At factor≥2 the
			// source-rate lag is ≤ 0.25 samples and `round(0.5/F) = 0`
			// rounds away — adding a whole-sample delay would *introduce*
			// an audible in-band comb, so the dry path runs undelayed.
			if (this.dryDelayEnabled) {
				let prevDry = this.dryDelaySamples[ch] ?? 0;

				for (let index = 0; index < frames; index++) {
					const drySample = inCh[index] ?? 0;
					const emphasized = (shaped[index] ?? 0) * harmonics;

					outCh[index] = prevDry * dryMix + emphasized * mix;
					prevDry = drySample;
				}

				this.dryDelaySamples[ch] = prevDry;
			} else {
				for (let index = 0; index < frames; index++) {
					const drySample = inCh[index] ?? 0;
					const emphasized = (shaped[index] ?? 0) * harmonics;

					outCh[index] = drySample * dryMix + emphasized * mix;
				}
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
