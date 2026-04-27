import { z } from "zod";
import {
	BufferedTransformStream,
	TransformNode,
	WHOLE_FILE,
	type AudioChunk,
	type BufferedAudioNodeInput,
	type ChunkBuffer,
	type StreamContext,
	type TransformNodeProperties,
} from "@e9g/buffered-audio-nodes-core";
import { createFftWorkspace, fft, hanningWindow, ifft, initFftBackend, stft, type FftBackend } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import {
	applyBinaryMask,
	computeAdaptiveThreshold,
	DEFAULT_BMRI_THRESHOLD_OPTIONS,
	dilateMaskTFCells,
} from "./utils/bmri-mask";
import { detectArResidual } from "./utils/bmri-ar-detection";
import { lsarInterpolate } from "./utils/lsar";

// BMRI per-block AR order per design-declick "Algorithm-internal scalars not
// exposed": p_det = p_int = 32. Detection and interpolation use the same
// model per Ruhland §II.B–C.
const BMRI_AR_ORDER = 32;

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	frequencySkew: z.number().min(-1).max(1).multipleOf(0.01).default(0).describe("Frequency Skew"),
	clickWidening: z.number().min(0).max(1).multipleOf(0.01).default(0.25).describe("Click Widening"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(200).describe("Max Click Duration (ms)"),
	minFrequency: z.number().min(0).default(0).describe("Min Frequency (Hz)"),
	maxFrequency: z.number().positive().optional().describe("Max Frequency (Hz)"),
	fftSize: z.number().min(512).max(16384).multipleOf(256).default(2048).describe("FFT Size"),
	hopSize: z.number().min(128).max(4096).multipleOf(64).default(1024).describe("Hop Size"),
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

export interface DeClickProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Ruhland 2015 Binary Mask Residual Interpolation (BMRI) for click removal.
 *
 * The STFT of the input is split into two spectrally-disjoint paths by an
 * adaptive-threshold binary mask (§II.A, §II.A.1): bins whose magnitude sits
 * above the per-bin-per-frame threshold `ξ̂[k,λ]` (recursively-smoothed
 * periodogram estimate plus a 1/f-compensating offset) pass through a "target"
 * path unchanged; bins below threshold are routed to a "residual" path where
 * an AR(32) γ-percent rank rule flags impulsive samples (§II.B) and an LSAR
 * linear-system solve interpolates them (§II.C). The interpolated residual is
 * re-transformed, mask-consistency-corrected (§II.D zeroes residual bins the
 * mask had kept in the target) and recombined via OLA synthesis.
 *
 * The BMRI mask-kept cells pass through bit-for-bit up to iSTFT round-trip
 * precision — the algorithm avoids the "sliced sample / distortion" failure
 * mode of time-domain LSAR over broad gaps by confining the AR interpolator
 * to the spectrally-thinned residual. Parameter mapping (design-declick
 * "Parameter mapping"): `sensitivity` → γ (linear, `γ = 0.125 · sensitivity`),
 * `frequencySkew` → additive bias on the β_dec offset slope (0–10 dB/dec at
 * skew ∈ [-1, +1]), `clickWidening` → rectangular TF-mask dilation radius
 * (0–3 cells each axis), `maxClickDuration` → post-flag guard clearing any
 * contiguous run of AR-flagged samples whose length exceeds the threshold,
 * `minFrequency` / `maxFrequency` → band restriction on the mask (bins
 * outside the band are force-kept in the target path regardless of the
 * adaptive threshold comparison, matching RX's empirical ~100 Hz – 5 kHz
 * detection band; design-declick decision log 2026-04-24).
 *
 * @see Ruhland, M., Bitzer, J., Brandt, M., & Goetze, S. (2015). "Reduction
 *   of Gaussian, Supergaussian, and Impulsive Noise by Interpolation of the
 *   Binary Mask Residual." IEEE/ACM TASLP 23(10), 1680–1691.
 */
export class DeClickStream extends BufferedTransformStream<DeClickProperties> {
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;

		if (frames === 0) return;

		const sampleRate = this.sampleRate ?? 44100;
		const { sensitivity, frequencySkew, clickWidening, maxClickDuration, minFrequency, maxFrequency, fftSize, hopSize } = this.properties;

		// UI-level "off" position. Per design-declick Parameter mapping,
		// `γ = 0.125 · sensitivity`, so sensitivity = 0 ⇒ γ = 0 ⇒ no samples
		// flagged ⇒ output identical to input. The early exit skips the cost
		// of the BMRI pipeline for this common case.
		if (sensitivity === 0) return;

		// BMRI does not guard clipped plateaus. Under Oudre+G&R, time-domain
		// LSAR replaced every sample inside a detected gap and a clipped
		// plateau produced large sign-alternating residuals; the old path
		// excluded clipped regions from the gap set before LSAR. Under BMRI,
		// mask-kept bins at a clipped peak pass through the target path
		// unchanged — the clipped plateau is already preserved bit-for-bit
		// by construction. If Phase 6 listening shows over-processing of
		// clipped peaks, reinstate a clipping-mask guard here as a post-hoc
		// patch. See plan-declick-bmri-rewrite.md §2.1 step 7.

		const allAudio = await buffer.read(0, frames);

		if (channels === 0 || allAudio.samples.length === 0) return;

		const numBins = fftSize / 2 + 1;

		// BMRI parameter mapping (design-declick "Parameter mapping").
		const gamma = 0.125 * sensitivity;
		const betaDec = 5 + frequencySkew * 5;
		const radiusFrames = Math.round(clickWidening * 3);
		const radiusBins = Math.round(clickWidening * 3);
		const maxDurationSamples = Math.round((maxClickDuration / 1000) * sampleRate);
		const thresholdOptions = { ...DEFAULT_BMRI_THRESHOLD_OPTIONS, betaDecDbPerDecade: betaDec };

		// Hop-aligned length so every input sample sits under full Hann COLA
		// coverage. Matches the de-reverb tail-padding convention.
		const rawLength = Math.max(frames, fftSize);
		const alignedLength = rawLength + ((hopSize - ((rawLength - fftSize) % hopSize)) % hopSize);

		// Ruhland 2015 §II.D / Fig. 5: the BMRI pipeline is per-frame.
		// For each analysis frame λ we separately:
		//   1. iDFT the mask-rejected bins R[k,λ] to a length-L residual
		//      BLOCK r[λM+n] (pure IDFT of one frame's STFT bins — NOT an
		//      OLA-synthesised global residual signal).
		//   2. Run AR(32) detection + LSAR interpolation on r[λM+n].
		//   3. Forward-DFT r̃[λM+n] back to R̃[k,λ].
		//   4. Form the per-frame restored spectrum ŷ_spec[k,λ] = T[k,λ] on
		//      mask-kept bins (mask === 0) and ŷ_spec[k,λ] = R̃[k,λ] on
		//      mask-rejected bins (mask === 1). This is Eq. 16 combined with
		//      §II.D's spectral correction: mask-kept cells carry target
		//      energy exclusively, mask-rejected cells carry LSAR-cleaned
		//      residual energy exclusively.
		//   5. iDFT ŷ_spec[k,λ] to the length-L restored frame block.
		//   6. Hann-window the frame block and accumulate into the final
		//      output with 50%-overlap-add.
		// Final normalisation divides by the per-sample sum of synthesis
		// Hann² so the COLA reconstruction has unity gain.
		//
		// The earlier "iSTFT → per-block AR on the OLA'd residual stream →
		// re-STFT" layout produced +5 dBFS residual peaks because per-frame
		// IDFTs differ structurally from windowed-OLA time signals: the
		// AR fit sees a different block content, the re-STFT reapplies the
		// analysis window, and mask-rejected-bin energy leaks into mask-kept
		// bins through the intermediate synthesis window. Ruhland §II.A Eqs.
		// 4–5 are explicit that t[λM+n] and r[λM+n] are "the time-domain
		// signal blocks" per frame, not OLA-synthesised global signals.
		const hanning = hanningWindow(fftSize);
		const fftWorkspace = createFftWorkspace(fftSize);

		for (let ch = 0; ch < channels; ch++) {
			const channelSource = allAudio.samples[ch];

			if (!channelSource) continue;

			const channel = new Float32Array(alignedLength);

			channel.set(channelSource.subarray(0, Math.min(channelSource.length, alignedLength)));

			// Forward STFT of the whole channel buffer. stft already applies
			// the analysis Hann window; the returned spectra are DFT(Hann·frame).
			const spectra = stft(channel, fftSize, hopSize, undefined, this.fftBackend, this.fftAddonOptions);

			// §II.A + §II.A.1: adaptive threshold + binary mask split.
			// `minFrequency` / `maxFrequency` restrict the mask to RX's empirical
			// ~100 Hz – 5 kHz detection band (design-declick 2026-04-24 decision
			// log). Bins outside the band are force-kept in the target path so
			// high-frequency sibilance / breath / air content is never treated
			// as a click. `maxFrequency === undefined` means no upper cap.
			const threshold = computeAdaptiveThreshold(spectra, sampleRate, fftSize, hopSize, thresholdOptions);
			const { mask } = applyBinaryMask(spectra, threshold, {
				sampleRate,
				fftSize,
				minFrequencyHz: minFrequency,
				maxFrequencyHz: maxFrequency,
			});

			// clickWidening: morphological dilation of the TF mask.
			const dilated = dilateMaskTFCells(mask, spectra.frames, numBins, radiusFrames, radiusBins);

			const numFrames = spectra.frames;
			const output = new Float32Array(alignedLength);
			const windowSquaredSum = new Float32Array(alignedLength);

			// Scratch buffers for per-frame processing.
			const fullRe = new Float32Array(fftSize);
			const fullIm = new Float32Array(fftSize);
			const residualBlock = new Float32Array(fftSize);
			const outputSpecRe = new Float32Array(numBins);
			const outputSpecIm = new Float32Array(numBins);

			for (let frame = 0; frame < numFrames; frame++) {
				const binOffset = frame * numBins;
				const frameStart = frame * hopSize;

				// Step 1: build the full-size complex spectrum of R[k,λ] via
				// conjugate symmetry, then iDFT to r[λM+n]. Mask-kept bins
				// (mask === 0) contribute zero; mask-rejected bins (mask === 1)
				// carry the original spectrum.
				fullRe.fill(0);
				fullIm.fill(0);

				for (let bin = 0; bin < numBins; bin++) {
					if ((dilated[binOffset + bin] ?? 0) === 1) {
						fullRe[bin] = spectra.real[binOffset + bin] ?? 0;
						fullIm[bin] = spectra.imag[binOffset + bin] ?? 0;
					}
				}

				// Hermitian symmetry for a real IDFT output: X[N-k] = conj(X[k]).
				for (let bin = 1; bin < numBins - 1; bin++) {
					fullRe[fftSize - bin] = fullRe[bin] ?? 0;
					fullIm[fftSize - bin] = -(fullIm[bin] ?? 0);
				}

				const residualTime = ifft(fullRe, fullIm, fftWorkspace);

				for (let index = 0; index < fftSize; index++) residualBlock[index] = residualTime[index] ?? 0;

				// Step 2: AR detection + LSAR interpolation on the residual block.
				const { flagged, coeffs } = detectArResidual(residualBlock, BMRI_AR_ORDER, gamma);

				// maxClickDuration guard: clear any contiguous run of flagged
				// samples longer than `maxDurationSamples`.
				if (maxDurationSamples > 0) clearLongRuns(flagged, maxDurationSamples);

				const flaggedIndices: Array<number> = [];

				for (let index = 0; index < flagged.length; index++) {
					if (flagged[index] === 1) flaggedIndices.push(index);
				}

				let residualModified = false;

				if (flaggedIndices.length > 0) {
					lsarInterpolate(residualBlock, flaggedIndices, coeffs);
					residualModified = true;
				}

				// Step 3+4: build the per-frame output spectrum. If LSAR did
				// not modify the block, we can skip the DFT round-trip and
				// use the original spectra directly — at mask-kept bins the
				// output is T[k,λ] = spectra[k,λ] (dilated==0), at mask-rejected
				// bins the output is R[k,λ] = spectra[k,λ] (dilated==1). Either
				// way the output is spectra unchanged.
				if (residualModified) {
					// Forward DFT of the LSAR-interpolated residual block.
					const { re: residualSpecRe, im: residualSpecIm } = fft(residualBlock, fftWorkspace);

					// Build ŷ_spec[k,λ]: target at mask-kept bins, R̃ at
					// mask-rejected bins. Spectral correction (§II.D) is
					// implicit in this bin-wise selection — mask-kept bins of
					// R̃ are never written to the output spectrum.
					for (let bin = 0; bin < numBins; bin++) {
						if ((dilated[binOffset + bin] ?? 0) === 1) {
							outputSpecRe[bin] = residualSpecRe[bin] ?? 0;
							outputSpecIm[bin] = residualSpecIm[bin] ?? 0;
						} else {
							outputSpecRe[bin] = spectra.real[binOffset + bin] ?? 0;
							outputSpecIm[bin] = spectra.imag[binOffset + bin] ?? 0;
						}
					}

					// Expand to full complex via Hermitian symmetry.
					fullRe.fill(0);
					fullIm.fill(0);

					for (let bin = 0; bin < numBins; bin++) {
						fullRe[bin] = outputSpecRe[bin] ?? 0;
						fullIm[bin] = outputSpecIm[bin] ?? 0;
					}

					for (let bin = 1; bin < numBins - 1; bin++) {
						fullRe[fftSize - bin] = outputSpecRe[bin] ?? 0;
						fullIm[fftSize - bin] = -(outputSpecIm[bin] ?? 0);
					}

					// Step 5: iDFT to the length-L restored frame block.
					const restoredBlock = ifft(fullRe, fullIm, fftWorkspace);

					// Step 6: Hann-window + 50%-OLA into the output.
					for (let index = 0; index < fftSize; index++) {
						const outIndex = frameStart + index;

						if (outIndex >= alignedLength) break;

						const windowValue = hanning[index] ?? 0;

						output[outIndex] = (output[outIndex] ?? 0) + (restoredBlock[index] ?? 0) * windowValue;
						windowSquaredSum[outIndex] = (windowSquaredSum[outIndex] ?? 0) + windowValue * windowValue;
					}
				} else {
					// No LSAR modification: the per-frame restored block equals
					// iDFT of the original spectra, which equals the analysis-
					// windowed input frame (Hann·channel[frameStart..]). We
					// avoid a redundant DFT/iDFT round-trip and OLA the already-
					// windowed input directly with a second Hann (matching the
					// LSAR path's synthesis-window scaling).
					for (let index = 0; index < fftSize; index++) {
						const outIndex = frameStart + index;

						if (outIndex >= alignedLength) break;

						const windowValue = hanning[index] ?? 0;
						const sample = channel[outIndex] ?? 0;

						// analysis-windowed frame sample = w · x; synthesis-
						// windowed OLA accumulator: += (w · x) · w = w² · x.
						output[outIndex] = (output[outIndex] ?? 0) + windowValue * windowValue * sample;
						windowSquaredSum[outIndex] = (windowSquaredSum[outIndex] ?? 0) + windowValue * windowValue;
					}
				}
			}

			// Final COLA normalisation: divide by the per-sample Σ w²[n - λM].
			for (let index = 0; index < alignedLength; index++) {
				const ws = windowSquaredSum[index] ?? 0;

				if (ws > 1e-8) output[index] = (output[index] ?? 0) / ws;
			}

			// Truncate back to the original frame count and write into the
			// audio samples buffer.
			const truncated = output.subarray(0, frames);

			channelSource.set(truncated);
		}

		await buffer.truncate(0);
		await buffer.append(allAudio.samples);
	}
}

/**
 * In-place clear of any contiguous run of `1`s in `flagged` whose length
 * exceeds `maxLen`. Used as the BMRI post-flag safety guard against long
 * AR-flagged runs that are almost certainly voice content, not clicks
 * (design-declick "Parameter mapping" §`maxClickDuration`).
 */
function clearLongRuns(flagged: Uint8Array, maxLen: number): void {
	const length = flagged.length;
	let runStart = -1;

	for (let index = 0; index <= length; index++) {
		const active = index < length && flagged[index] === 1;

		if (active) {
			if (runStart === -1) runStart = index;
		} else if (runStart !== -1) {
			const runLen = index - runStart;

			if (runLen > maxLen) {
				for (let clearIndex = runStart; clearIndex < index; clearIndex++) flagged[clearIndex] = 0;
			}

			runStart = -1;
		}
	}
}

/**
 * Detects impulsive noise (clicks, pops) and reconstructs the affected
 * cells via Ruhland 2015 Binary Mask Residual Interpolation. One
 * authoritative algorithm, no mode variants.
 */
export class DeClickNode<P extends DeClickProperties = DeClickProperties> extends TransformNode<P> {
	static override readonly moduleName: string = "De-Click";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Remove clicks, pops, and impulse artifacts (Ruhland 2015 BMRI)";
	static override readonly schema: z.ZodType = schema;

	static override is(value: unknown): value is DeClickNode {
		return TransformNode.is(value) && value.type[2] === "de-click";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-click"];

	constructor(properties?: BufferedAudioNodeInput<P>) {
		const parsed = schema.parse(properties ?? {});

		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties, ...parsed } as BufferedAudioNodeInput<P>);
	}

	override createStream(): DeClickStream {
		return new DeClickStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeClickProperties>): DeClickNode {
		return new DeClickNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deClick(options?: {
	sensitivity?: number;
	frequencySkew?: number;
	clickWidening?: number;
	maxClickDuration?: number;
	minFrequency?: number;
	maxFrequency?: number;
	fftSize?: number;
	hopSize?: number;
	vkfftAddonPath?: string;
	fftwAddonPath?: string;
	id?: string;
}): DeClickNode {
	const parsed = schema.parse(options ?? {});

	return new DeClickNode({ ...parsed, id: options?.id });
}
