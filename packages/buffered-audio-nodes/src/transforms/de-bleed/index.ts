/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { applyDfttSmoothing, applyNlmSmoothing, getFftAddon, initFftBackend, istft, replaceChannel, stft, type FftBackend, type StftOutput } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { readToBuffer } from "../../utils/read-to-buffer";
import { accumulateTransferChunk, createTransferAccumulator, findMaxRefPower, finalizeTransferFunction } from "./utils/cross-spectral";
import { computeFrameGainMask } from "./utils/gain-mask";

export const schema = z.object({
	references: z.array(z.string()).default([]).describe("References"),
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
	dfttBackend: z.enum(["", "js", "fftw", "vkfft"]).default("").describe("DFTT Backend Override"),
});

export interface DeBleedProperties extends z.infer<typeof schema>, TransformNodeProperties {}

// Streaming chunked two-pass `_process` budget and carry constants. See
// design-de-bleed.md 2026-04-21 "Streaming chunked two-pass `_process`" for the
// per-chunk STFT matrix budget and 2026-04-21 "DFTT batched via addon 2D FFT"
// for the DFTT batched-buffer peak (~73 MB at default params) that motivates
// the 96 MB ceiling.
const BUDGET_BYTES = Number(process.env.DEBLEED_BUDGET_BYTES) || 96 * 1024 * 1024;
const MATRIX_COUNT = 5;
const FLOOR_FRAMES = 256;
const CEILING_FRAMES = Number(process.env.DEBLEED_CEILING_FRAMES) || 4096;
const MAX_CARRY_FRAMES = 32;

function computeChunkFrames(numBins: number): number {
	const rawFrames = Math.floor(BUDGET_BYTES / (MATRIX_COUNT * numBins * 4));

	return Math.max(FLOOR_FRAMES, Math.min(CEILING_FRAMES, rawFrames));
}

function allocateStftOutput(frames: number, numBins: number): StftOutput {
	return {
		real: new Float32Array(frames * numBins),
		imag: new Float32Array(frames * numBins),
	};
}

/**
 * Read `frames` STFT frames worth of samples from `chunkBuffer` channel
 * `channelIndex` starting at global STFT frame `startFrame`, into `out`
 * (zero-padded for any tail past the buffer end or when `channelIndex` is
 * out of range). Mutates `out`; caller must size it to at least
 * `frames * hopSize + (fftSize - hopSize)` samples.
 */
/**
 * Read `frames` STFT frames worth of samples from `chunkBuffer` channel
 * `channelIndex` starting at virtual STFT frame `startFrame`, into `out`.
 *
 * When `edgePadSamples > 0`, the file is treated as if it were virtually
 * extended by `edgePadSamples` zero samples at the start AND end. This
 * fixes the under-determined iSTFT OLA windowSum at file boundaries:
 * virtually padding by `(fftSize - hopSize)` makes the iSTFT
 * reconstruction zone align with the real `[0, totalFrames)` range so no
 * downstream edge-guard is needed. Pass `edgePadSamples=0` for analysis
 * passes that want to scan real audio (e.g., cross-spectral H estimation).
 */
async function readChunkIntoPadded(
	chunkBuffer: ChunkBuffer,
	channelIndex: number,
	startFrame: number,
	frames: number,
	out: Float32Array,
	hopSize: number,
	fftSize: number,
	edgePadSamples = 0,
): Promise<void> {
	out.fill(0);

	const samplesRequired = frames * hopSize + (fftSize - hopSize);

	if (samplesRequired <= 0) return;

	const virtualStart = startFrame * hopSize;
	const realStart = virtualStart - edgePadSamples;
	const realEnd = realStart + samplesRequired;

	const totalFrames = chunkBuffer.frames;
	const readStart = Math.max(0, realStart);
	const readEnd = Math.min(totalFrames, realEnd);
	const readLen = readEnd - readStart;

	if (readLen <= 0) return;

	const chunk = await chunkBuffer.read(readStart, readLen);
	const channel = chunk.samples[channelIndex];

	if (!channel) return;

	const writeOffset = readStart - realStart;
	const copyLength = Math.min(channel.length, out.length - writeOffset);

	if (copyLength > 0) out.set(channel.subarray(0, copyLength), writeOffset);
}

/**
 * Reduces bleed from one or more reference microphone signals into a target
 * microphone using spectral-domain cross-talk cancellation. References are
 * fused into a single combined-bleed prediction — see design-de-bleed.md
 * "Multi-reference fused node" 2026-04-21. Three stages:
 *
 * 1. Learn pass — estimate the complex transfer function Hᵢ(f) per reference
 *    from the energy-ratio-weighted cross-spectral density of the target and
 *    that reference's STFT over the whole file. Each Hᵢ is learned
 *    independently; uncorrelated target speech averages out per pair.
 * 2. Process pass — predict combined bleed as the complex sum
 *    B_total = Σᵢ Hᵢ·Rᵢ (bleed components interfere coherently, so complex
 *    summation is the correct physical model). Compute one Wiener-style gain
 *    mask via Boll (1979) spectral subtraction with oversubtraction factor α.
 * 3. Artifact smoothing — 2D Non-Local Means + DFT-thresholding smoothing of
 *    the single combined mask to suppress musical noise. NLM+DFTT runs once
 *    per chunk regardless of reference count.
 *
 * Both passes stream the target in N-frame chunks (N derived from BUDGET_BYTES)
 * with `MAX_CARRY_FRAMES` frames of carry on each side in Pass 2 so NLM/DFTT see
 * enough context. Each reference `ChunkBuffer` stays open for the lifetime of
 * the stream and is closed in `_teardown`.
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
	private dfttFftBackend?: FftBackend;
	private dfttFftAddonOptions?: { vkfftPath?: string; fftwPath?: string };
	private referenceBuffers: Array<ChunkBuffer> = [];
	private chunkFrames!: number;
	private numBins!: number;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		// Resolve the DFTT-specific backend. Empty-string override follows the
		// pipeline's selection (same as main STFT). Explicit "js"/"fftw"/"vkfft"
		// forces the DFTT stage onto that backend; the main STFT still uses
		// `this.fftBackend` / `this.fftAddonOptions` above. See design-de-bleed.md
		// 2026-04-21 "DFTT batched via addon 2D FFT" and the 3×3 matrix follow-up
		// in debleed-cpu-perf.md §2.9 Notes.
		const { dfttBackend, fftwAddonPath, vkfftAddonPath } = this.properties;

		if (dfttBackend === "") {
			this.dfttFftBackend = fft.backend;
			this.dfttFftAddonOptions = fft.addonOptions;
		} else if (dfttBackend === "js") {
			this.dfttFftBackend = "js";
			this.dfttFftAddonOptions = undefined;
		} else if (dfttBackend === "fftw") {
			if (!fftwAddonPath) {
				throw new Error("de-bleed: dfttBackend='fftw' requires fftwAddonPath to be set on the node.");
			}

			this.dfttFftBackend = "fftw";
			this.dfttFftAddonOptions = { fftwPath: fftwAddonPath };

			const addon = getFftAddon("fftw", this.dfttFftAddonOptions);

			if (!addon) {
				throw new Error(`de-bleed: dfttBackend='fftw' could not load FFTW addon at ${fftwAddonPath}.`);
			}
		} else {
			// dfttBackend === "vkfft"
			if (!vkfftAddonPath) {
				throw new Error("de-bleed: dfttBackend='vkfft' requires vkfftAddonPath to be set on the node.");
			}

			this.dfttFftBackend = "vkfft";
			this.dfttFftAddonOptions = { vkfftPath: vkfftAddonPath };

			const addon = getFftAddon("vkfft", this.dfttFftAddonOptions);

			if (!addon) {
				throw new Error(`de-bleed: dfttBackend='vkfft' could not load VkFFT addon at ${vkfftAddonPath}.`);
			}
		}

		const openedBuffers: Array<ChunkBuffer> = [];

		try {
			for (const refPath of this.properties.references) {
				const { buffer: refBuffer } = await readToBuffer(refPath);

				openedBuffers.push(refBuffer);
			}

			this.referenceBuffers = openedBuffers;

			const { fftSize } = this.properties;

			this.numBins = fftSize / 2 + 1;
			this.chunkFrames = computeChunkFrames(this.numBins);

			return await super._setup(input, context);
		} catch (error) {
			for (const refBuffer of openedBuffers) {
				await refBuffer.close();
			}

			this.referenceBuffers = [];

			throw error;
		}
	}

	override async _teardown(): Promise<void> {
		for (const buffer of this.referenceBuffers) {
			await buffer.close();
		}

		this.referenceBuffers = [];
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames: totalFrames, channels } = buffer;
		const { fftSize, hopSize, reductionStrength, artifactSmoothing } = this.properties;
		const { chunkFrames, numBins, referenceBuffers } = this;
		const refCount = referenceBuffers.length;

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

		// Edge pad for the process pass (Pass 2). The iSTFT OLA windowSum is
		// partial within `(fftSize - hopSize)` samples of any signal boundary
		// — only 1..3 frames overlap there vs the steady-state
		// `fftSize / hopSize`. We virtually extend the file with
		// `edgePadSamples` zeros at the start AND end during Pass 2; the
		// iSTFT then reconstructs the original `[0, totalFrames)` range from
		// a fully-determined windowSum and no edge-guard trim is needed.
		// Pass 1b (cross-spectral analysis) still scans the real-signal range
		// so its `readChunkIntoPadded` calls are made with `edgePadSamples=0`.
		const edgePadSamples = fftSize - hopSize;
		const virtualTotal = totalFrames + 2 * edgePadSamples;
		const virtualLogicalLength = Math.max(virtualTotal, fftSize);
		const virtualPaddedLength = virtualLogicalLength + ((hopSize - ((virtualLogicalLength - fftSize) % hopSize)) % hopSize);
		const processStftFrames = Math.floor((virtualPaddedLength - fftSize) / hopSize) + 1;

		// Window size for Pass 2: center chunk + carry on both sides. Pass 1 chunks
		// never exceed chunkFrames, so the Pass-2 window sizes everything safely.
		const windowFrames = chunkFrames + 2 * carry;
		const windowSamples = windowFrames * hopSize + (fftSize - hopSize);

		const targetStftOutput = allocateStftOutput(windowFrames, numBins);
		const refStftOutputs: Array<StftOutput> = Array.from({ length: refCount }, () => allocateStftOutput(windowFrames, numBins));
		const rawMask = new Float32Array(windowFrames * numBins);
		const nlmMask = new Float32Array(windowFrames * numBins);
		const finalMask = new Float32Array(windowFrames * numBins);
		const targetPadded = new Float32Array(windowSamples);
		const refPaddeds: Array<Float32Array> = Array.from({ length: refCount }, () => new Float32Array(windowSamples));

		// Per-frame scratch holders for the mask-assembly call. Reused across
		// frames so we never allocate inside the inner per-frame loop.
		const refFrameReals = new Array<Float32Array>(refCount);
		const refFrameImags = new Array<Float32Array>(refCount);

		for (let ch = 0; ch < channels; ch++) {
			// --- Pass 1: learn Hᵢ for this channel, per reference ---
			// Mini-pass 1a: find whole-file max |Rᵢ|² on each reference for its own
			// scalar weight regulariser. Bit-compatible with the one-shot pre-pass.
			const maxRefPows: Array<number> = new Array<number>(refCount).fill(0);

			for (let chunkStart = 0; chunkStart < totalStftFrames; chunkStart += chunkFrames) {
				const framesThisChunk = Math.min(chunkFrames, totalStftFrames - chunkStart);
				const chunkSamples = framesThisChunk * hopSize + (fftSize - hopSize);

				for (let refIndex = 0; refIndex < refCount; refIndex++) {
					await readChunkIntoPadded(referenceBuffers[refIndex]!, 0, chunkStart, framesThisChunk, refPaddeds[refIndex]!, hopSize, fftSize);

					const refStft = stft(refPaddeds[refIndex]!.subarray(0, chunkSamples), fftSize, hopSize, refStftOutputs[refIndex], this.fftBackend, this.fftAddonOptions);

					maxRefPows[refIndex] = Math.max(maxRefPows[refIndex]!, findMaxRefPower(refStft.real, refStft.imag, refStft.frames, numBins));
				}
			}

			const weightEpsilons: Array<number> = maxRefPows.map((maxPow) => 1e-10 * (maxPow + 1e-20));

			// Mini-pass 1b: accumulate energy-ratio-weighted cross-spectrum per reference.
			const accumulators = referenceBuffers.map(() => createTransferAccumulator(numBins));

			for (let chunkStart = 0; chunkStart < totalStftFrames; chunkStart += chunkFrames) {
				const framesThisChunk = Math.min(chunkFrames, totalStftFrames - chunkStart);
				const chunkSamples = framesThisChunk * hopSize + (fftSize - hopSize);

				await readChunkIntoPadded(buffer, ch, chunkStart, framesThisChunk, targetPadded, hopSize, fftSize);

				const targetStft = stft(targetPadded.subarray(0, chunkSamples), fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);

				for (let refIndex = 0; refIndex < refCount; refIndex++) {
					await readChunkIntoPadded(referenceBuffers[refIndex]!, 0, chunkStart, framesThisChunk, refPaddeds[refIndex]!, hopSize, fftSize);

					const refStft = stft(refPaddeds[refIndex]!.subarray(0, chunkSamples), fftSize, hopSize, refStftOutputs[refIndex], this.fftBackend, this.fftAddonOptions);

					accumulateTransferChunk(targetStft.real, targetStft.imag, refStft.real, refStft.imag, targetStft.frames, numBins, weightEpsilons[refIndex]!, accumulators[refIndex]!);
				}
			}

			const transfers = accumulators.map((acc) => finalizeTransferFunction(acc));
			const transferReals: Array<Float32Array> = transfers.map((transfer) => transfer.real);
			const transferImags: Array<Float32Array> = transfers.map((transfer) => transfer.imag);

			// --- Pass 2: process with carry ---
			// Iterates over the VIRTUAL signal (real audio padded by `edgePadSamples`
			// zeros at start and end). Reads pass `edgePadSamples` so the helper
			// returns zeros for sample positions outside `[0, totalFrames)`.
			for (let outStart = 0; outStart < processStftFrames; outStart += chunkFrames) {
				const outFramesThisChunk = Math.min(chunkFrames, processStftFrames - outStart);
				const winStart = Math.max(0, outStart - carry);
				const winEnd = Math.min(processStftFrames, outStart + outFramesThisChunk + carry);
				const winFrames = winEnd - winStart;
				const winSamples = winFrames * hopSize + (fftSize - hopSize);

				await readChunkIntoPadded(buffer, ch, winStart, winFrames, targetPadded, hopSize, fftSize, edgePadSamples);

				const targetStft = stft(targetPadded.subarray(0, winSamples), fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);

				// STFT each reference once per chunk.
				const refStftsForChunk = new Array<StftOutput>(refCount);

				for (let refIndex = 0; refIndex < refCount; refIndex++) {
					await readChunkIntoPadded(referenceBuffers[refIndex]!, 0, winStart, winFrames, refPaddeds[refIndex]!, hopSize, fftSize, edgePadSamples);

					refStftsForChunk[refIndex] = stft(refPaddeds[refIndex]!.subarray(0, winSamples), fftSize, hopSize, refStftOutputs[refIndex], this.fftBackend, this.fftAddonOptions);
				}

				// Per-frame combined-B mask over the whole window.
				// NLM/DFTT clamping handles shorter windows at file edges.
				for (let frame = 0; frame < winFrames; frame++) {
					const frameOffset = frame * numBins;
					const frameReal = targetStft.real.subarray(frameOffset, frameOffset + numBins);
					const frameImag = targetStft.imag.subarray(frameOffset, frameOffset + numBins);

					for (let refIndex = 0; refIndex < refCount; refIndex++) {
						refFrameReals[refIndex] = refStftsForChunk[refIndex]!.real.subarray(frameOffset, frameOffset + numBins);
						refFrameImags[refIndex] = refStftsForChunk[refIndex]!.imag.subarray(frameOffset, frameOffset + numBins);
					}

					const maskFrame = rawMask.subarray(frameOffset, frameOffset + numBins);

					computeFrameGainMask(frameReal, frameImag, refFrameReals, refFrameImags, transferReals, transferImags, alpha, 1e-10, maskFrame);
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
					this.dfttFftBackend,
					this.dfttFftAddonOptions,
				);

				// Apply the final mask to the target STFT in-place (phase preserved).
				const targetRealBuf = targetStft.real;
				const targetImagBuf = targetStft.imag;

				for (let frame = 0; frame < winFrames; frame++) {
					const frameOffset = frame * numBins;

					for (let bin = 0; bin < numBins; bin++) {
						const gain = finalView[frameOffset + bin]!;

						targetRealBuf[frameOffset + bin] = targetRealBuf[frameOffset + bin]! * gain;
						targetImagBuf[frameOffset + bin] = targetImagBuf[frameOffset + bin]! * gain;
					}
				}

				const cleaned = istft(targetStft, hopSize, winSamples, this.fftBackend, this.fftAddonOptions);

				// Write only the center-N sample region back. Adjacent chunks
				// overlap in STFT frames via the carry and reconstruct the shared
				// samples identically (STFT is stateless); the center-only write
				// preserves that reconstruction without double-writing.
				const centerStartFrame = outStart - winStart;
				const centerStartSample = centerStartFrame * hopSize;
				const isFinalChunk = outStart + outFramesThisChunk >= processStftFrames;
				const centerEndSample = isFinalChunk ? cleaned.length : (centerStartFrame + outFramesThisChunk) * hopSize;
				const centerSamples = cleaned.subarray(centerStartSample, centerEndSample);

				// Map the virtual write range back to real-file samples by subtracting
				// the leading edge pad. iSTFT positions within the virtual pad zones
				// (real < 0 or real >= totalFrames) are dropped — they correspond to
				// the zero-pad boundaries that existed only to give the OLA windowSum
				// full overlap at the real-file edges. No additional edge-guard is
				// needed: the iSTFT now reconstructs `[0, totalFrames)` correctly.
				const virtualWriteStart = winStart * hopSize + centerStartSample;
				const realWriteStart = virtualWriteStart - edgePadSamples;
				const realWriteEnd = realWriteStart + centerSamples.length;
				const clipStart = Math.max(0, realWriteStart);
				const clipEnd = Math.min(totalFrames, realWriteEnd);

				if (clipEnd <= clipStart) continue;

				const sliceFromOffset = clipStart - realWriteStart;
				const sliceLength = clipEnd - clipStart;
				const writeSamples = centerSamples.subarray(sliceFromOffset, sliceFromOffset + sliceLength);

				const existingChunk = await buffer.read(clipStart, sliceLength);

				await buffer.write(clipStart, replaceChannel(existingChunk, ch, writeSamples, channels));
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
	references: string | ReadonlyArray<string>,
	options?: {
		reductionStrength?: number;
		artifactSmoothing?: number;
		fftSize?: number;
		hopSize?: number;
		vkfftAddonPath?: string;
		fftwAddonPath?: string;
		dfttBackend?: "" | "js" | "fftw" | "vkfft";
		id?: string;
	},
): DeBleedNode {
	const referencesArray = typeof references === "string" ? [references] : [...references];

	return new DeBleedNode({
		references: referencesArray,
		reductionStrength: options?.reductionStrength ?? 3,
		artifactSmoothing: options?.artifactSmoothing ?? 4,
		fftSize: options?.fftSize ?? 4096,
		hopSize: options?.hopSize ?? 1024,
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		dfttBackend: options?.dfttBackend ?? "",
		id: options?.id,
	});
}
