
import { z } from "zod";
import {
	BufferedTransformStream,
	TransformNode,
	WHOLE_FILE,
	type AudioChunk,
	type ChunkBuffer,
	type StreamContext,
	type TransformNodeProperties,
} from "@e9g/buffered-audio-nodes-core";
import {
	applyDfttSmoothing,
	applyNlmSmoothing,
	initFftBackend,
	istft,
	replaceChannel,
	stft,
	type FftBackend,
} from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { bandBinGroups } from "./utils/bands";
import { applyEnhanceDry, computeRawGain, createReverbState, enhanceDryBoostLin } from "./utils/gain-mask";
import { learnReverbProfile, type ReverbProfile } from "./utils/learn";

const reverbProfileSchema = z.object({
	alpha: z.number(),
	beta: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});

export const schema = z.object({
	reduction: z.number().min(0).max(10).multipleOf(0.1).default(5).describe("Reduction"),
	tailLength: z.number().min(0.5).max(4).multipleOf(0.01).default(1).describe("Tail Length"),
	artifactSmoothing: z.number().min(0).max(10).multipleOf(0.1).default(2).describe("Artifact Smoothing"),
	enhanceDry: z.boolean().default(false).describe("Enhance Dry Signal"),
	outputReverbOnly: z.boolean().default(false).describe("Output Reverb Only"),
	reverbProfile: reverbProfileSchema.optional().describe("Reverb Profile"),
	learnStart: z.number().min(0).optional().describe("Learn Start (seconds)"),
	learnEnd: z.number().min(0).optional().describe("Learn End (seconds)"),
	fftSize: z.number().min(512).max(16384).multipleOf(256).default(2048).describe("FFT Size"),
	hopSize: z.number().min(128).max(4096).multipleOf(64).default(512).describe("Hop Size"),
	vkfftAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "vkfft-addon", download: "https://github.com/visionsofparadise/vkfft-addon" })
		.describe("VkFFT native addon — GPU FFT acceleration"),
	fftwAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "fftw-addon", download: "https://github.com/visionsofparadise/fftw-addon" })
		.describe("FFTW native addon — CPU FFT acceleration"),
});

export interface DeReverbProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Classical RX-style De-Reverb.
 *
 * Implements the baseline algorithm iZotope engineers write out in full in
 * §2.1 of Nercessian & Lukin (2019), "Speech Dereverberation Using Recurrent
 * Neural Networks" (DAFx-19), with the Lukin & Todd (2007) NLM+DFTT post-
 * filter (AES 123rd Convention Paper 7168) as the "extra time-frequency
 * smoothing" that §2.1 [8] cites.
 *
 * Forward model (Nercessian & Lukin 2019 Eq. 1 + Eq. 2, per bin of the
 * magnitude spectrum):
 *   r_t = α · s_t + (1 − α) · r_{t−1}        (1)
 *   y_t = s_t + β · r_t                      (2)
 * with α a scalar (frequency-independent) and β a 4-vector (per band).
 *
 * Pipeline:
 *   1. STFT per channel.
 *   2. Learn pass (offline whole-file or learnStart/learnEnd window) produces
 *      `(α, β[1..4])`. α estimation: decimate signal by R=15 at 48 kHz
 *      (Löllmann 2010 Eq. 11, `f_eff ≈ 3.2 kHz`); per-frame Löllmann §III
 *      Eq. 14 sub-frame monotone-decrease pre-selection on the downsampled
 *      signal with weight factors `w_var = w_max = w_min = 0.995` and
 *      partial-streak acceptance `l_min = 3`; Ratnam 2003 Eq. 8 ML decay-rate
 *      score function (σ² profiled out via Eq. 11) on an adaptive buffer
 *      sized to the detected streak; histogram bin width 0.05 s over
 *      [0.05, 10] s; argmax → T̂₆₀ → α at source rate. β per-band (splits at
 *      500 / 2000 / 8000 Hz → Low / Mid-Low / Mid-High / High) in closed form
 *      — non-negativity-constrained energy minimiser on `|Y|/r` over the
 *      learn window.
 *   3. Process pass: invert (1)+(2) per frame for ŝ_t = max(|Y| − β·r, 0),
 *      raw gain G_raw = ŝ / (|Y| + ε). Optional cosmetic +1 dB "Enhance
 *      Dry" boost on bins with G > 0.9.
 *   4. Post-filter G_raw through Lukin & Todd 2007 2D NLM (§4.1) then
 *      DFTT (§4.2) to produce G_smoothed.
 *   5. Apply G_smoothed to the complex STFT (phase preserved); iSTFT. With
 *      `outputReverbOnly`, apply `(1 − G_smoothed)` instead.
 *
 * Learn precedence: `reverbProfile > [learnStart, learnEnd] > full buffer`.
 */
export class DeReverbStream extends BufferedTransformStream<DeReverbProperties> {
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames, channels } = buffer;

		if (frames === 0) return;

		const sampleRate = buffer.sampleRate ?? 48000;
		const {
			fftSize,
			hopSize,
			reduction,
			tailLength: _tailLength,  
			artifactSmoothing,
			enhanceDry,
			outputReverbOnly,
			reverbProfile,
			learnStart,
			learnEnd,
		} = this.properties;

		const numBins = fftSize / 2 + 1;
		// iSTFT length equals forward STFT input length. Pad to hop alignment so
		// the final frame is fully covered by Hann COLA. With the Nercessian-
		// Lukin inversion the Wiener-style gain drops toward 0 on silent tails.
		const rawLength = Math.max(frames, fftSize);
		const alignedLength = rawLength + ((hopSize - ((rawLength - fftSize) % hopSize)) % hopSize);

		const bands = bandBinGroups(fftSize, sampleRate);
		// `reduction` is 0..10 (design doc); caller normalises to a scalar in
		// [0, 1] before handing to `computeRawGain`, which applies
		// β_applied[b] = reductionScale · β_learned[b] per design doc.
		const reductionScale = reduction / 10;
		const boostLin = enhanceDryBoostLin(1);
		const smoothingThreshold = artifactSmoothing * 0.1;

		const chunk = await buffer.read(0, frames);

		for (let ch = 0; ch < channels; ch++) {
			const channelSource = chunk.samples[ch];

			if (!channelSource) continue;

			const channel = new Float32Array(alignedLength);

			channel.set(channelSource.subarray(0, Math.min(channelSource.length, alignedLength)));

			const stftResult = stft(channel, fftSize, hopSize, undefined, this.fftBackend, this.fftAddonOptions);
			const numFrames = stftResult.frames;

			// --- Learn pass ---
			// Precedence: reverbProfile > [learnStart, learnEnd] > full buffer.
			let profile: ReverbProfile;

			if (reverbProfile) {
				profile = { alpha: reverbProfile.alpha, beta: reverbProfile.beta };
			} else {
				const windowStartFrame = learnStart !== undefined ? Math.max(0, Math.floor((learnStart * sampleRate) / hopSize)) : 0;
				const windowEndFrame = learnEnd !== undefined ? Math.min(numFrames, Math.ceil((learnEnd * sampleRate) / hopSize)) : numFrames;

				profile = learnReverbProfile(stftResult, channel, sampleRate, hopSize, {
					startFrame: windowStartFrame,
					endFrame: windowEndFrame,
				});
			}

			// --- Raw-mask pass (per-frame Eq. (1)+(2) inversion over the whole buffer) ---
			const rawMask = new Float32Array(numFrames * numBins);
			const nlmMask = new Float32Array(numFrames * numBins);
			const finalMask = new Float32Array(numFrames * numBins);
			const state = createReverbState(numBins);
			const magY = new Float32Array(numBins);

			for (let frame = 0; frame < numFrames; frame++) {
				const frameOffset = frame * numBins;

				for (let bin = 0; bin < numBins; bin++) {
					const re = stftResult.real[frameOffset + bin] ?? 0;
					const im = stftResult.imag[frameOffset + bin] ?? 0;

					magY[bin] = Math.sqrt(re * re + im * im);
				}

				const rawFrameView = rawMask.subarray(frameOffset, frameOffset + numBins);

				computeRawGain(magY, profile.alpha, profile.beta, bands, reductionScale, state, rawFrameView);

				if (enhanceDry) applyEnhanceDry(rawFrameView, boostLin);
			}

			// --- NLM + DFTT smoothing (Lukin & Todd 2007 §4.1 + §4.2) ---
			applyNlmSmoothing(
				rawMask,
				numFrames,
				numBins,
				{
					patchSize: 8,
					searchFreqRadius: 8,
					searchTimePre: 16,
					searchTimePost: 4,
					pasteBlockSize: 4,
					threshold: smoothingThreshold,
				},
				nlmMask,
			);

			applyDfttSmoothing(
				nlmMask,
				rawMask,
				numFrames,
				numBins,
				{
					blockFreq: 32,
					blockTime: 16,
					hopFreq: 8,
					hopTime: 4,
					threshold: smoothingThreshold,
				},
				finalMask,
				this.fftBackend,
				this.fftAddonOptions,
			);

			// --- Apply smoothed mask to the complex STFT, honouring outputReverbOnly ---
			for (let frame = 0; frame < numFrames; frame++) {
				const frameOffset = frame * numBins;

				for (let bin = 0; bin < numBins; bin++) {
					const maskValue = finalMask[frameOffset + bin] ?? 0;
					const appliedGain = outputReverbOnly ? 1 - maskValue : maskValue;

					stftResult.real[frameOffset + bin] = (stftResult.real[frameOffset + bin] ?? 0) * appliedGain;
					stftResult.imag[frameOffset + bin] = (stftResult.imag[frameOffset + bin] ?? 0) * appliedGain;
				}
			}

			const dereverberated = istft(stftResult, hopSize, alignedLength, this.fftBackend, this.fftAddonOptions).subarray(0, frames);

			await buffer.write(0, replaceChannel(chunk, ch, dereverberated, channels));
		}
	}
}

/**
 * Classical RX-style De-Reverb node. See {@link DeReverbStream} for the
 * algorithm.
 *
 * @see Nercessian, S. & Lukin, A. (2019). "Speech Dereverberation Using
 *   Recurrent Neural Networks." DAFx-19, §2.1 (Eq. 1 + Eq. 2).
 * @see Lukin, A. & Todd, J. (2007). "Suppression of Musical Noise Artifacts
 *   in Audio Noise Reduction by Adaptive 2D Filtering." AES 123rd Convention,
 *   Paper 7168. §4.1 (NLM) + §4.2 (DFTT) + §4.3 (STFT parameters).
 * @see Löllmann, H. W. et al. (2010). "An improved algorithm for blind
 *   reverberation time estimation." IWAENC 2010, §III + Table I
 *   (downsampling Eq. 11, sub-frame pre-selection Eq. 14, weight factors,
 *   partial-streak acceptance).
 * @see Ratnam, R. et al. (2003). "Blind estimation of reverberation time."
 *   JASA 114(5), §II (Eq. 8 ML decay-rate score, Eq. 11 σ² profile-out).
 */
export class DeReverbNode extends TransformNode<DeReverbProperties> {
	static override readonly moduleName = "De-Reverb";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Classical dereverberation via Nercessian & Lukin 2019 §2.1 + Lukin & Todd 2007 post-filter";
	static override readonly schema = schema;

	static override is(value: unknown): value is DeReverbNode {
		return TransformNode.is(value) && value.type[2] === "de-reverb";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-reverb"] as const;

	constructor(properties: DeReverbProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): DeReverbStream {
		return new DeReverbStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeReverbProperties>): DeReverbNode {
		return new DeReverbNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

/**
 * Factory for a {@link DeReverbNode}. See {@link DeReverbStream} for the
 * algorithm and {@link schema} for the parameter ranges and defaults.
 */
export function deReverb(options?: {
	reduction?: number;
	tailLength?: number;
	artifactSmoothing?: number;
	enhanceDry?: boolean;
	outputReverbOnly?: boolean;
	reverbProfile?: { alpha: number; beta: [number, number, number, number] };
	learnStart?: number;
	learnEnd?: number;
	fftSize?: number;
	hopSize?: number;
	vkfftAddonPath?: string;
	fftwAddonPath?: string;
	id?: string;
}): DeReverbNode {
	return new DeReverbNode({
		reduction: options?.reduction ?? 5,
		tailLength: options?.tailLength ?? 1,
		artifactSmoothing: options?.artifactSmoothing ?? 2,
		enhanceDry: options?.enhanceDry ?? false,
		outputReverbOnly: options?.outputReverbOnly ?? false,
		reverbProfile: options?.reverbProfile,
		learnStart: options?.learnStart,
		learnEnd: options?.learnEnd,
		fftSize: options?.fftSize ?? 2048,
		hopSize: options?.hopSize ?? 512,
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		id: options?.id,
	});
}
