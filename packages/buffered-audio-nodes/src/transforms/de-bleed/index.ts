/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { initFftBackend, istft, replaceChannel, stft, type FftBackend, type StftOutput } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { readToBuffer } from "../../utils/read-to-buffer";
import { accumulateTransferChunk, createTransferAccumulator, findMaxRefPower, finalizeTransferFunction } from "./utils/cross-spectral";
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

// Streaming chunked two-pass `_process` budget and carry constants. See
// design-de-bleed.md "Streaming chunked two-pass `_process`" 2026-04-21.
const BUDGET_BYTES = 32 * 1024 * 1024;
const MATRIX_COUNT = 5;
const FLOOR_FRAMES = 256;
const CEILING_FRAMES = 4096;
const MAX_CARRY_FRAMES = 32;

function computeChunkFrames(numBins: number): number {
	const rawFrames = Math.floor(BUDGET_BYTES / (MATRIX_COUNT * numBins * 4));

	return Math.max(FLOOR_FRAMES, Math.min(CEILING_FRAMES, rawFrames));
}

function allocateStftOutput(frames: number, numBins: number): StftOutput {
	return {
		real: Array.from({ length: frames }, () => new Float32Array(numBins)),
		imag: Array.from({ length: frames }, () => new Float32Array(numBins)),
	};
}

/**
 * Read `frames` STFT frames worth of samples from `chunkBuffer` channel
 * `channelIndex` starting at global STFT frame `startFrame`, into `out`
 * (zero-padded for any tail past the buffer end or when `channelIndex` is
 * out of range). Mutates `out`; caller must size it to at least
 * `frames * hopSize + (fftSize - hopSize)` samples.
 */
async function readChunkIntoPadded(
	chunkBuffer: ChunkBuffer,
	channelIndex: number,
	startFrame: number,
	frames: number,
	out: Float32Array,
	hopSize: number,
	fftSize: number,
): Promise<void> {
	out.fill(0);

	const sampleOffset = startFrame * hopSize;
	const samplesRequired = frames * hopSize + (fftSize - hopSize);

	if (samplesRequired <= 0) return;

	const chunk = await chunkBuffer.read(sampleOffset, samplesRequired);
	const channel = chunk.samples[channelIndex];

	if (!channel) return;

	const copyLength = Math.min(channel.length, out.length);

	out.set(channel.subarray(0, copyLength));
}

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
 * Both passes stream the target in N-frame chunks (N derived from BUDGET_BYTES)
 * with `MAX_CARRY_FRAMES` frames of carry on each side in Pass 2 so NLM/DFTT see
 * enough context. The reference `ChunkBuffer` stays open for the lifetime of the
 * stream and is closed in `_teardown`.
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
	private referenceBuffer?: ChunkBuffer;
	private chunkFrames!: number;
	private numBins!: number;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		const { buffer: refBuffer } = await readToBuffer(this.properties.referencePath);

		try {
			this.referenceBuffer = refBuffer;

			const { fftSize } = this.properties;

			this.numBins = fftSize / 2 + 1;
			this.chunkFrames = computeChunkFrames(this.numBins);

			return await super._setup(input, context);
		} catch (error) {
			await refBuffer.close();
			this.referenceBuffer = undefined;

			throw error;
		}
	}

	override async _teardown(): Promise<void> {
		if (this.referenceBuffer) {
			await this.referenceBuffer.close();
			this.referenceBuffer = undefined;
		}
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames: totalFrames, channels } = buffer;
		const { fftSize, hopSize, reductionStrength, artifactSmoothing } = this.properties;
		const { chunkFrames, numBins } = this;
		const referenceBuffer = this.referenceBuffer;

		if (!referenceBuffer) throw new Error("DeBleedStream: referenceBuffer not initialised");

		// α = reductionStrength / 4 (Boll oversubtraction factor per design-de-bleed).
		const alpha = reductionStrength / 4;
		// Linear scaling K = 0.1 maps artifactSmoothing ∈ [0,15] → threshold ∈ [0,1.5].
		const thresholdScale = 0.1;
		const threshold = artifactSmoothing * thresholdScale;
		const carry = MAX_CARRY_FRAMES;

		// Mirror whole-file paddedLength formula so chunk-aligned STFT frame count
		// matches what the pre-streaming one-shot implementation produced.
		const logicalTargetLength = Math.max(totalFrames, fftSize);
		const paddedLength = logicalTargetLength + ((hopSize - ((logicalTargetLength - fftSize) % hopSize)) % hopSize);
		const totalStftFrames = Math.floor((paddedLength - fftSize) / hopSize) + 1;

		// Window size for Pass 2: center chunk + carry on both sides. Pass 1 chunks
		// never exceed chunkFrames, so the Pass-2 window sizes everything safely.
		const windowFrames = chunkFrames + 2 * carry;
		const windowSamples = windowFrames * hopSize + (fftSize - hopSize);

		const targetStftOutput = allocateStftOutput(windowFrames, numBins);
		const refStftOutput = allocateStftOutput(windowFrames, numBins);
		const rawMask = new Float32Array(windowFrames * numBins);
		const nlmMask = new Float32Array(windowFrames * numBins);
		const finalMask = new Float32Array(windowFrames * numBins);
		const targetPadded = new Float32Array(windowSamples);
		const refPadded = new Float32Array(windowSamples);

		for (let ch = 0; ch < channels; ch++) {
			// --- Pass 1: learn H for this channel ---
			// Mini-pass 1a: find whole-file max |R|² on the reference for the scalar
			// weight regulariser. Bit-compatible with the one-shot pre-pass.
			let maxRefPow = 0;

			for (let chunkStart = 0; chunkStart < totalStftFrames; chunkStart += chunkFrames) {
				const framesThisChunk = Math.min(chunkFrames, totalStftFrames - chunkStart);

				await readChunkIntoPadded(referenceBuffer, 0, chunkStart, framesThisChunk, refPadded, hopSize, fftSize);

				const refSamples = framesThisChunk * hopSize + (fftSize - hopSize);
				const refStft = stft(refPadded.subarray(0, refSamples), fftSize, hopSize, refStftOutput, this.fftBackend, this.fftAddonOptions);

				maxRefPow = Math.max(maxRefPow, findMaxRefPower(refStft.real, refStft.imag, refStft.frames, numBins));
			}

			const weightEpsilon = 1e-10 * (maxRefPow + 1e-20);

			// Mini-pass 1b: accumulate energy-ratio-weighted cross-spectrum.
			const accumulator = createTransferAccumulator(numBins);

			for (let chunkStart = 0; chunkStart < totalStftFrames; chunkStart += chunkFrames) {
				const framesThisChunk = Math.min(chunkFrames, totalStftFrames - chunkStart);

				await readChunkIntoPadded(buffer, ch, chunkStart, framesThisChunk, targetPadded, hopSize, fftSize);
				await readChunkIntoPadded(referenceBuffer, 0, chunkStart, framesThisChunk, refPadded, hopSize, fftSize);

				const chunkSamples = framesThisChunk * hopSize + (fftSize - hopSize);
				const targetStft = stft(targetPadded.subarray(0, chunkSamples), fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);
				const refStft = stft(refPadded.subarray(0, chunkSamples), fftSize, hopSize, refStftOutput, this.fftBackend, this.fftAddonOptions);

				accumulateTransferChunk(targetStft.real, targetStft.imag, refStft.real, refStft.imag, targetStft.frames, numBins, weightEpsilon, accumulator);
			}

			const transfer = finalizeTransferFunction(accumulator);
			const transferReal = transfer.real;
			const transferImag = transfer.imag;

			// --- Pass 2: process with carry ---
			for (let outStart = 0; outStart < totalStftFrames; outStart += chunkFrames) {
				const outFramesThisChunk = Math.min(chunkFrames, totalStftFrames - outStart);
				const winStart = Math.max(0, outStart - carry);
				const winEnd = Math.min(totalStftFrames, outStart + outFramesThisChunk + carry);
				const winFrames = winEnd - winStart;
				const winSamples = winFrames * hopSize + (fftSize - hopSize);

				await readChunkIntoPadded(buffer, ch, winStart, winFrames, targetPadded, hopSize, fftSize);
				await readChunkIntoPadded(referenceBuffer, 0, winStart, winFrames, refPadded, hopSize, fftSize);

				const targetStft = stft(targetPadded.subarray(0, winSamples), fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);
				const refStft = stft(refPadded.subarray(0, winSamples), fftSize, hopSize, refStftOutput, this.fftBackend, this.fftAddonOptions);

				// Per-frame Boll-style raw gain mask over the whole window.
				// NLM/DFTT clamping handles shorter windows at file edges.
				for (let frame = 0; frame < winFrames; frame++) {
					const frameReal = targetStft.real[frame]!;
					const frameImag = targetStft.imag[frame]!;
					const refFrameReal = refStft.real[frame]!;
					const refFrameImag = refStft.imag[frame]!;
					const maskFrame = rawMask.subarray(frame * numBins, (frame + 1) * numBins);

					computeFrameGainMask(frameReal, frameImag, refFrameReal, refFrameImag, transferReal, transferImag, alpha, 1e-10, maskFrame);
				}

				const rawView = rawMask.subarray(0, winFrames * numBins);
				const nlmView = nlmMask.subarray(0, winFrames * numBins);
				const finalView = finalMask.subarray(0, winFrames * numBins);

				// Stage 3a — 2D NLM smoothing of the gain mask (Lukin & Todd 2007, §4.1).
				applyNlmSmoothing(
					rawView,
					winFrames,
					numBins,
					{
						patchSize: 8,
						searchFreqRadius: 8,
						searchTimePre: 16,
						searchTimePost: 4,
						pasteBlockSize: 4,
						threshold,
					},
					nlmView,
				);

				// Stage 3b — DFT-thresholding post-smoothing (Lukin & Todd 2007, §4.2).
				applyDfttSmoothing(
					nlmView,
					rawView,
					winFrames,
					numBins,
					{
						blockFreq: 32,
						blockTime: 16,
						hopFreq: 8,
						hopTime: 4,
						threshold,
					},
					finalView,
				);

				// Apply the final mask to the target STFT in-place (phase preserved).
				for (let frame = 0; frame < winFrames; frame++) {
					const frameReal = targetStft.real[frame]!;
					const frameImag = targetStft.imag[frame]!;
					const maskOffset = frame * numBins;

					for (let bin = 0; bin < numBins; bin++) {
						const gain = finalView[maskOffset + bin]!;

						frameReal[bin] = frameReal[bin]! * gain;
						frameImag[bin] = frameImag[bin]! * gain;
					}
				}

				const cleaned = istft(targetStft, hopSize, winSamples, this.fftBackend, this.fftAddonOptions);

				// Write only the center-N sample region back. Adjacent chunks
				// overlap in STFT frames via the carry and reconstruct the shared
				// samples identically (STFT is stateless); the center-only write
				// preserves that reconstruction without double-writing.
				const centerStartFrame = outStart - winStart;
				const centerStartSample = centerStartFrame * hopSize;
				const isFinalChunk = outStart + outFramesThisChunk >= totalStftFrames;
				const centerEndSample = isFinalChunk ? cleaned.length : (centerStartFrame + outFramesThisChunk) * hopSize;
				const centerSamples = cleaned.subarray(centerStartSample, centerEndSample);

				// On the final chunk, trim to totalFrames so we don't extend the
				// target buffer past its original length (the padded tail is zero).
				const writeOffset = winStart * hopSize + centerStartSample;
				const maxWrite = totalFrames - writeOffset;

				if (maxWrite <= 0) continue;

				const samplesToWrite = Math.min(centerSamples.length, maxWrite);
				const writeSamples = centerSamples.subarray(0, samplesToWrite);

				const existingChunk = await buffer.read(writeOffset, samplesToWrite);

				await buffer.write(writeOffset, replaceChannel(existingChunk, ch, writeSamples, channels));
			}
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
