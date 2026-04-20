/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { initFftBackend, istft, replaceChannel, stft, type FftBackend, type StftOutput } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { readToBuffer } from "../../utils/read-to-buffer";
import { estimateTransferFunction } from "./utils/cross-spectral";
import { computeFrameGainMask } from "./utils/gain-mask";
import { applyNlmSmoothing } from "./utils/nlm-smoothing";
import { applyDfttSmoothing } from "./utils/dftt-smoothing";

export const schema = z.object({
	referencePath: z.string().default("").describe("Reference Path"),
	reductionStrength: z.number().min(0).max(8).multipleOf(0.1).default(3).describe("Reduction Strength"),
	artifactSmoothing: z.number().min(0).max(15).multipleOf(0.1).default(4).describe("Artifact Smoothing"),
	fftSize: z.number().min(512).max(16384).multipleOf(256).default(4096).describe("FFT Size"),
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

export interface DeBleedProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Reduces reference-microphone bleed from a target microphone using spectral-domain
 * cross-talk cancellation. Three stages:
 *
 * 1. Learn pass — estimate complex transfer function H(f) from cross-spectral density
 *    of target and reference STFTs over the whole file. Uncorrelated target speech
 *    averages out, leaving the bleed path.
 * 2. Process pass — predict bleed B = H·R, compute Wiener-style gain mask via
 *    Boll (1979) spectral subtraction with oversubtraction factor α.
 * 3. Artifact smoothing — 2D Non-Local Means + DFT-thresholding smoothing of the
 *    gain mask to suppress musical noise (chirpy / watery FFT-processing artifacts).
 *
 * @see Welch, P. (1967). "The use of fast Fourier transform for the estimation of
 *   power spectra." IEEE Trans. Audio Electroacoustics, 15(2), 70–73.
 * @see Boll, S. F. (1979). "Suppression of acoustic noise in speech using spectral
 *   subtraction." IEEE Trans. ASSP, 27(2), 113–120.
 * @see Lukin, A. & Todd, J. (2007). "Suppression of Musical Noise Artifacts in
 *   Audio Noise Reduction by Adaptive 2D Filtering." 123rd AES Convention, Paper 7168.
 *   PDF: http://imaging.cs.msu.ru/pub/MusicalNoise07.pdf
 * @see Buades, A., Coll, B., Morel, J. (2005). "Image Denoising By Non-Local
 *   Averaging." IEEE ICASSP 2005, vol. 2, pp. 25–28.
 */
export class DeBleedStream extends BufferedTransformStream<DeBleedProperties> {
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };
	private referenceSignal!: Float32Array;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		const { buffer: refBuffer } = await readToBuffer(this.properties.referencePath);
		const refChunk = await refBuffer.read(0, refBuffer.frames);
		const refChannel = refChunk.samples[0];

		this.referenceSignal = refChannel ? Float32Array.from(refChannel) : new Float32Array(0);
		await refBuffer.close();

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames, channels } = buffer;
		const { fftSize, hopSize, reductionStrength, artifactSmoothing } = this.properties;

		const numBins = fftSize / 2 + 1;
		const targetLength = Math.max(frames, fftSize);
		// Pad to a multiple of hopSize past fftSize so the final STFT window fits cleanly.
		const paddedLength = targetLength + ((hopSize - ((targetLength - fftSize) % hopSize)) % hopSize);
		const numStftFrames = Math.floor((paddedLength - fftSize) / hopSize) + 1;

		const targetStftOutput: StftOutput = {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
		};
		const refStftOutput: StftOutput = {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
		};

		const chunk = await buffer.read(0, frames);
		const reference = this.referenceSignal;

		// α = reductionStrength / 4 (Boll oversubtraction factor per design-de-bleed).
		const alpha = reductionStrength / 4;
		// Linear scaling K = 0.1 maps artifactSmoothing ∈ [0,15] → threshold ∈ [0,1.5].
		const thresholdScale = 0.1;
		const threshold = artifactSmoothing * thresholdScale;

		// Pre-allocated, reused across channels.
		const targetPadded = new Float32Array(paddedLength);
		const refPadded = new Float32Array(paddedLength);
		const maskCells = numStftFrames * numBins;
		const rawMask = new Float32Array(maskCells);
		const nlmMask = new Float32Array(maskCells);
		const finalMask = new Float32Array(maskCells);

		for (let ch = 0; ch < channels; ch++) {
			const targetChannel = chunk.samples[ch];

			if (!targetChannel) continue;

			// Clip or zero-pad the reference to match the target length, then zero-pad both to paddedLength.
			const matchedLength = Math.min(targetChannel.length, reference.length);

			targetPadded.fill(0);
			refPadded.fill(0);
			targetPadded.set(targetChannel);
			refPadded.set(reference.subarray(0, matchedLength));

			const targetStft = stft(targetPadded, fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);
			const refStft = stft(refPadded, fftSize, hopSize, refStftOutput, this.fftBackend, this.fftAddonOptions);
			const numFrames = targetStft.frames;

			// Learn pass — estimate complex transfer function H(f) from cross-spectral density.
			const transfer = estimateTransferFunction(targetStft.real, targetStft.imag, refStft.real, refStft.imag, numFrames, numBins);
			const transferReal = transfer.real;
			const transferImag = transfer.imag;

			// Per-frame Boll-style gain mask. The threshold-before-smoothing ordering
			// preserves the target/bleed boundary through NLM + DFTT; see design-de-bleed
			// "Mask-domain smoothing instead of the paper's SNR-domain" for rationale.
			for (let frame = 0; frame < numFrames; frame++) {
				const frameReal = targetStft.real[frame]!;
				const frameImag = targetStft.imag[frame]!;
				const refFrameReal = refStft.real[frame]!;
				const refFrameImag = refStft.imag[frame]!;
				const maskFrame = rawMask.subarray(frame * numBins, (frame + 1) * numBins);

				computeFrameGainMask(frameReal, frameImag, refFrameReal, refFrameImag, transferReal, transferImag, alpha, 1e-10, maskFrame);
			}

			// Stage 3a — 2D Non-Local Means smoothing of the gain mask (Lukin & Todd 2007, §4.1).
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
					threshold,
				},
				nlmMask,
			);

			// Stage 3b — DFT-thresholding post-smoothing (Lukin & Todd 2007, §4.2).
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
					threshold,
				},
				finalMask,
			);

			// Apply the final mask to the target STFT in-place (phase preserved).
			for (let frame = 0; frame < numFrames; frame++) {
				const frameReal = targetStft.real[frame]!;
				const frameImag = targetStft.imag[frame]!;
				const maskOffset = frame * numBins;

				for (let bin = 0; bin < numBins; bin++) {
					const gain = finalMask[maskOffset + bin]!;

					frameReal[bin] = frameReal[bin]! * gain;
					frameImag[bin] = frameImag[bin]! * gain;
				}
			}

			const cleaned = istft(targetStft, hopSize, paddedLength, this.fftBackend, this.fftAddonOptions).subarray(0, frames);

			await buffer.write(0, replaceChannel(chunk, ch, cleaned, channels));
		}
	}
}

export class DeBleedNode extends TransformNode<DeBleedProperties> {
	static override readonly moduleName = "De-Bleed";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Reduce microphone bleed between channels using spectral-domain cross-talk cancellation";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeBleedNode {
		return TransformNode.is(value) && value.type[2] === "de-bleed";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-bleed"] as const;

	constructor(properties: DeBleedProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): DeBleedStream {
		return new DeBleedStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeBleedProperties>): DeBleedNode {
		return new DeBleedNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deBleed(
	referencePath: string,
	options?: {
		reductionStrength?: number;
		artifactSmoothing?: number;
		fftSize?: number;
		hopSize?: number;
		vkfftAddonPath?: string;
		fftwAddonPath?: string;
		id?: string;
	},
): DeBleedNode {
	return new DeBleedNode({
		referencePath,
		reductionStrength: options?.reductionStrength ?? 3,
		artifactSmoothing: options?.artifactSmoothing ?? 4,
		fftSize: options?.fftSize ?? 4096,
		hopSize: options?.hopSize ?? 1024,
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		id: options?.id,
	});
}
