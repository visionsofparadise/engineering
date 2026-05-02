/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { applyDfttSmoothing, applyNlmSmoothing, getFftAddon, initFftBackend, istft, replaceChannel, stft, type FftBackend, type StftOutput } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { readToBuffer } from "../../utils/read-to-buffer";
import { accumulateTransferChunk, createTransferAccumulator, finalizeTransferFunction, findMaxRefPower, type TransferFunction } from "./utils/cross-spectral";
import { adaptationSpeedToMarkovForgetting, createKalmanState, kalmanUpdateFrame, type KalmanParams, type KalmanState } from "./utils/mef-kalman";
import { computeMwfMask, createInterfererPsdState, reductionStrengthToOversubtraction, updateInterfererPsd, updatePrevOutputPsd, type InterfererPsdState, type MwfParams } from "./utils/mef-mwf";
import { applyIspRestoration, computeMsadDecision, createIspState, createMsadChannelState, ISP_THRESHOLD_FRAMES, type IspState, type MsadChannelState } from "./utils/mef-msad";
import { coldStartSeed, validateTransferSeed } from "./utils/warmup";

// New parameter surface per design-de-bleed.md 2026-05-01 "New user parameter
// surface — `reductionStrength`, `artifactSmoothing`, `adaptationSpeed` over
// 0–10". `references` carries over the 2026-04-21 multi-reference decision.
// The old `referencePath` field is removed; old NLMS-era `filterLength` /
// `stepSize` stay removed.
export const schema = z.object({
	references: z.array(z.string()).default([]).describe("References"),
	reductionStrength: z.number().min(0).max(10).multipleOf(0.1).default(5).describe("Reduction Strength"),
	artifactSmoothing: z.number().min(0).max(10).multipleOf(0.1).default(5).describe("Artifact Smoothing"),
	adaptationSpeed: z.number().min(0).max(10).multipleOf(0.1).default(3).describe("Adaptation Speed"),
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

export interface DeBleedAdaptiveProperties extends z.infer<typeof schema>, TransformNodeProperties {}

// Streaming chunked `_process` budget and carry constants. See
// design-de-bleed.md 2026-04-21 "Streaming chunked two-pass `_process`" for the
// per-chunk STFT matrix budget and 2026-04-21 "DFTT batched via addon 2D FFT"
// for the DFTT batched-buffer peak (~73 MB at default params) that motivates
// the 96 MB ceiling.
const BUDGET_BYTES = Number(process.env.DEBLEED_BUDGET_BYTES) || 96 * 1024 * 1024;
const MATRIX_COUNT = 5;
const FLOOR_FRAMES = 256;
const CEILING_FRAMES = Number(process.env.DEBLEED_CEILING_FRAMES) || 4096;
const MAX_CARRY_FRAMES = 32;

// MEF parameter constants per design-de-bleed.md "2026-05-01: New user
// parameter surface" + "2026-05-01: Replace stages 1+2 with MEF".
//
//   λ = 0.3 · reductionStrength    (linear, default 1.5 at user 5)
//   A = 0.998^(2^((s−3)/3))        (default 0.998 at user 3)
//   β = 0.5                         (PSD temporal smoothing, MEF default)
//   warmupSeconds = 30              (~6× MEF's 2-s convergence time)
//   R/K = hopSize / fftSize         (MEF Eq. 23 factor; 0.25 at default 1024/4096)
//
// `K_kalman` (per-bin count for the Kalman state) is derived from `fftSize`
// per design-de-bleed.md "2026-05-01: Use existing fftSize=4096 STFT for MEF
// stages 1+2". Single internal constant referencing fftSize so a future move
// to a parallel-STFT design (Option B) is a one-place change.
const MEF_TEMPORAL_SMOOTHING = 0.5;
const WARMUP_SECONDS = 30;
const MWF_EPSILON = 1e-10;
const ARTIFACT_THRESHOLD_SCALE = 0.15; // user 0–10 × 0.15 → threshold 0–1.5 (matches legacy 0–15 × 0.1)

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
 *
 * When `edgePadSamples > 0`, the file is treated as if it were virtually
 * extended by `edgePadSamples` zero samples at the start AND end. Callers
 * pass `startFrame` indexed in the VIRTUAL signal (so `startFrame=0`
 * begins reading inside the leading virtual pad, producing zeros until the
 * pad is exhausted). This is the standard fix for the under-determined
 * iSTFT OLA windowSum at file boundaries — by virtually padding by
 * `fftSize - hopSize` at each edge, the iSTFT reconstruction zone aligns
 * with the original file's `[0, totalFrames)` range and no edge-guard
 * trim is needed downstream.
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

	// Virtual sample range covered by this read, mapped to real file samples
	// by subtracting the leading virtual pad. When edgePadSamples=0 this
	// reduces to the original behaviour.
	const virtualStart = startFrame * hopSize;
	const realStart = virtualStart - edgePadSamples;
	const realEnd = realStart + samplesRequired;

	// Intersect with the actual file range [0, totalFrames).
	const totalFrames = chunkBuffer.frames;
	const readStart = Math.max(0, realStart);
	const readEnd = Math.min(totalFrames, realEnd);
	const readLen = readEnd - readStart;

	if (readLen <= 0) return; // Entire requested range is in the virtual zero pad.

	const chunk = await chunkBuffer.read(readStart, readLen);
	const channel = chunk.samples[channelIndex];

	if (!channel) return;

	// Place the buffer samples into `out` at the offset that compensates for
	// any leading virtual pad samples we skipped reading.
	const writeOffset = readStart - realStart;
	const copyLength = Math.min(channel.length, out.length - writeOffset);

	if (copyLength > 0) out.set(channel.subarray(0, copyLength), writeOffset);
}

/**
 * Adaptive de-bleed node — Phase 2: MEF FDAF Kalman + MWF + Lukin-Todd
 * post-filter. Replaces Phase 1's stub of the legacy frozen-H + Boll
 * subtraction algorithm.
 *
 * Pipeline per design-de-bleed.md "2026-05-01: Replace stages 1+2 with MEF":
 *
 *   - **Stage 0 (MSAD)**: stubbed in Phase 2 to "no target speech active";
 *     Phase 3 implements MEF §4.1 Eqs. 31–37.
 *   - **Stage 1 (FDAF Kalman)**: per-frame frequency-domain Kalman update
 *     on `Ĥ_{m,μ}(ℓ,k)` per (target, reference) pair. Per-bin scalar state
 *     across `K_kalman = numBins = fftSize/2 + 1` bins (Option A, single STFT
 *     pipeline at `fftSize = 4096`).
 *   - **Stage 2 (MWF)**: per-frame Wiener gain mask with per-interferer PSD
 *     `Φ̂_{D̂D̂,m} = |D̂_m^total|²` smoothed temporally (β = 0.5 MEF default).
 *   - **Stage 3 (NLM + DFTT)**: Lukin-Todd 2D smoothing of the gain mask —
 *     unchanged from legacy node.
 *   - **Stage 4 (synthesis)**: iSTFT of the masked target STFT — unchanged.
 *
 * **Hard "do not extend" boundary** (Kokkinis): per-interferer PSD is
 * `|D̂^WF|²` from the Kalman bleed estimate ONLY. No PSD envelope of target,
 * no dominant-bin selection, no coherence-based interferer-PSD estimator.
 *
 * **Initialisation**: a first-N-seconds warm-up scan (`WARMUP_SECONDS = 30`)
 * runs the existing energy-ratio-weighted cross-spectral averaging on the
 * first 30 s of audio per (target channel, reference) pair. The resulting H
 * seeds the Kalman filter at frame 0 instead of MEF's specified `Ĥ(ℓ=0) = 0`.
 * If the warm-up estimate is degenerate (NaN, ≥80% of bins below
 * 1e-4 × max-bin-magnitude, or Inf/denormal), the seed is rejected and the
 * Kalman cold-starts at zero — taking the ~2 s convergence transient at file
 * head per MEF Fig. 8.
 */
export class DeBleedAdaptiveStream extends BufferedTransformStream<DeBleedAdaptiveProperties> {
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

		const { dfttBackend, fftwAddonPath, vkfftAddonPath } = this.properties;

		if (dfttBackend === "") {
			this.dfttFftBackend = fft.backend;
			this.dfttFftAddonOptions = fft.addonOptions;
		} else if (dfttBackend === "js") {
			this.dfttFftBackend = "js";
			this.dfttFftAddonOptions = undefined;
		} else if (dfttBackend === "fftw") {
			if (!fftwAddonPath) {
				throw new Error("de-bleed-adaptive: dfttBackend='fftw' requires fftwAddonPath to be set on the node.");
			}

			this.dfttFftBackend = "fftw";
			this.dfttFftAddonOptions = { fftwPath: fftwAddonPath };

			const addon = getFftAddon("fftw", this.dfttFftAddonOptions);

			if (!addon) {
				throw new Error(`de-bleed-adaptive: dfttBackend='fftw' could not load FFTW addon at ${fftwAddonPath}.`);
			}
		} else {
			// dfttBackend === "vkfft"
			if (!vkfftAddonPath) {
				throw new Error("de-bleed-adaptive: dfttBackend='vkfft' requires vkfftAddonPath to be set on the node.");
			}

			this.dfttFftBackend = "vkfft";
			this.dfttFftAddonOptions = { vkfftPath: vkfftAddonPath };

			const addon = getFftAddon("vkfft", this.dfttFftAddonOptions);

			if (!addon) {
				throw new Error(`de-bleed-adaptive: dfttBackend='vkfft' could not load VkFFT addon at ${vkfftAddonPath}.`);
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

	/**
	 * Run the first-N-seconds warm-up scan for one target channel per
	 * reference. Returns one `TransferFunction` per reference (length =
	 * `referenceBuffers.length`). Degeneracy validation and cold-start
	 * fallback per `validateTransferSeed`.
	 */
	private async warmupSeedsForChannel(
		buffer: ChunkBuffer,
		channelIndex: number,
		warmupFrames: number,
		fftSize: number,
		hopSize: number,
	): Promise<Array<TransferFunction>> {
		const { numBins, referenceBuffers } = this;
		const refCount = referenceBuffers.length;

		if (warmupFrames <= 0 || refCount === 0) {
			return Array.from({ length: refCount }, () => coldStartSeed(numBins));
		}

		// Pass A: scan refs to find max |R|² for the streaming weight regulariser.
		const maxRefPows = new Array<number>(refCount).fill(0);
		const targetPadded = new Float32Array(warmupFrames * hopSize + (fftSize - hopSize));
		const refPaddeds = Array.from({ length: refCount }, () => new Float32Array(warmupFrames * hopSize + (fftSize - hopSize)));
		const targetStftOutput = allocateStftOutput(warmupFrames, numBins);
		const refStftOutputs = Array.from({ length: refCount }, () => allocateStftOutput(warmupFrames, numBins));

		for (let refIndex = 0; refIndex < refCount; refIndex++) {
			await readChunkIntoPadded(referenceBuffers[refIndex]!, 0, 0, warmupFrames, refPaddeds[refIndex]!, hopSize, fftSize);

			const refStft = stft(refPaddeds[refIndex]!, fftSize, hopSize, refStftOutputs[refIndex], this.fftBackend, this.fftAddonOptions);

			maxRefPows[refIndex] = findMaxRefPower(refStft.real, refStft.imag, refStft.frames, numBins);
		}

		// Pass B: accumulate energy-ratio-weighted cross-power.
		const accumulators = referenceBuffers.map(() => createTransferAccumulator(numBins));
		const weightEpsilons = maxRefPows.map((maxPow) => 1e-10 * (maxPow + 1e-20));

		await readChunkIntoPadded(buffer, channelIndex, 0, warmupFrames, targetPadded, hopSize, fftSize);

		const targetStft = stft(targetPadded, fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);

		for (let refIndex = 0; refIndex < refCount; refIndex++) {
			await readChunkIntoPadded(referenceBuffers[refIndex]!, 0, 0, warmupFrames, refPaddeds[refIndex]!, hopSize, fftSize);

			const refStft = stft(refPaddeds[refIndex]!, fftSize, hopSize, refStftOutputs[refIndex], this.fftBackend, this.fftAddonOptions);

			accumulateTransferChunk(targetStft.real, targetStft.imag, refStft.real, refStft.imag, targetStft.frames, numBins, weightEpsilons[refIndex]!, accumulators[refIndex]!);
		}

		const seeds = accumulators.map((acc) => finalizeTransferFunction(acc));

		// Validate each seed; replace degenerates with cold-start.
		const validated = seeds.map((seed) => {
			const validation = validateTransferSeed(seed);

			if (validation.degenerate) {
				 
				console.warn(`de-bleed-adaptive: warm-up seed degenerate (${validation.reason}); falling back to cold-start Ĥ(ℓ=0) = 0.`);

				return coldStartSeed(numBins);
			}

			return seed;
		});

		return validated;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames: totalFrames, channels, sampleRate } = buffer;
		const { fftSize, hopSize, reductionStrength, artifactSmoothing, adaptationSpeed } = this.properties;
		const { chunkFrames, numBins, referenceBuffers } = this;
		const refCount = referenceBuffers.length;

		// Per-stage timing accumulators — populated only when DEBLEED_PROFILE=1.
		// Phase 5.1 instrumentation per plan-debleed-v2-rx-match.md. Off-by-default
		// to keep production hot path branch-free; the env-var read is hoisted out
		// of all loops here.
		const profileEnabled = process.env.DEBLEED_PROFILE === "1";
		const profileMs = { warmup: 0, stftRead: 0, msad: 0, kalman: 0, mwf: 0, nlm: 0, dftt: 0, applyMaskIstft: 0, write: 0 };
		const _profStart = (): number => profileEnabled ? performance.now() : 0;
		const _profAdd = (key: keyof typeof profileMs, t0: number): void => {
			if (profileEnabled) profileMs[key] += performance.now() - t0;
		};

		// MEF parameter mappings per the design's parameter-surface decision.
		const lambda = reductionStrengthToOversubtraction(reductionStrength);
		const markovForgetting = adaptationSpeedToMarkovForgetting(adaptationSpeed);
		const threshold = artifactSmoothing * ARTIFACT_THRESHOLD_SCALE;

		const kalmanParams: KalmanParams = {
			markovForgetting,
			temporalSmoothing: MEF_TEMPORAL_SMOOTHING,
			rOverK: hopSize / fftSize,
		};

		const mwfParams: MwfParams = {
			temporalSmoothing: MEF_TEMPORAL_SMOOTHING,
			oversubtraction: lambda,
		};

		const carry = MAX_CARRY_FRAMES;

		// Mirror legacy paddedLength formula so chunk-aligned STFT frame count
		// matches the pre-streaming one-shot implementation.
		const logicalTargetLength = Math.max(totalFrames, fftSize);
		const paddedLength = logicalTargetLength + ((hopSize - ((logicalTargetLength - fftSize) % hopSize)) % hopSize);
		const totalStftFrames = Math.floor((paddedLength - fftSize) / hopSize) + 1;

		// Edge pad for the process pass. The iSTFT OLA windowSum is partial
		// within `(fftSize - hopSize)` samples of any signal boundary — only
		// 1..3 frames overlap there vs the steady-state `fftSize / hopSize`.
		// We virtually extend the file with `edgePadSamples` zeros at the
		// start AND end during the process pass; the iSTFT then reconstructs
		// the original `[0, totalFrames)` range from a fully-determined
		// windowSum and no edge-guard trim is needed. Warm-up still operates
		// on the real-signal range (it wants real samples for H estimation,
		// so `readChunkIntoPadded` is called there with `edgePadSamples=0`).
		const edgePadSamples = fftSize - hopSize;
		const virtualTotal = totalFrames + 2 * edgePadSamples;
		const virtualLogicalLength = Math.max(virtualTotal, fftSize);
		const virtualPaddedLength = virtualLogicalLength + ((hopSize - ((virtualLogicalLength - fftSize) % hopSize)) % hopSize);
		const processStftFrames = Math.floor((virtualPaddedLength - fftSize) / hopSize) + 1;

		// Warm-up scan: first WARMUP_SECONDS of audio, capped to total file length.
		// `sampleRate` is provided by the framework; default to 48 kHz if missing.
		const effectiveSampleRate = sampleRate ?? 48000;
		const warmupSamples = Math.min(WARMUP_SECONDS * effectiveSampleRate, totalFrames);
		const warmupFrames = Math.max(0, Math.floor((warmupSamples - fftSize) / hopSize) + 1);

		const windowFrames = chunkFrames + 2 * carry;
		const windowSamples = windowFrames * hopSize + (fftSize - hopSize);

		const targetStftOutput = allocateStftOutput(windowFrames, numBins);
		const refStftOutputs: Array<StftOutput> = Array.from({ length: refCount }, () => allocateStftOutput(windowFrames, numBins));
		const rawMask = new Float32Array(windowFrames * numBins);
		const nlmMask = new Float32Array(windowFrames * numBins);
		const finalMask = new Float32Array(windowFrames * numBins);
		const targetPadded = new Float32Array(windowSamples);
		const refPaddeds: Array<Float32Array> = Array.from({ length: refCount }, () => new Float32Array(windowSamples));

		// Per-frame scratch buffers for the Kalman + MWF inner loop.
		const refFrameReals = new Array<Float32Array>(refCount);
		const refFrameImags = new Array<Float32Array>(refCount);
		const bleedTotalReal = new Float32Array(numBins);
		const bleedTotalImag = new Float32Array(numBins);

		// MSAD ISP threshold: 0.5-s pause threshold per MEF §4.1, expressed in
		// frames given the current hop / sample rate. Falls back to the default
		// 24 frames (hop=1024, sr=48000) if sample rate is missing.
		const ispThresholdFrames = sampleRate ? Math.max(1, Math.round(0.5 * sampleRate / hopSize)) : ISP_THRESHOLD_FRAMES;

		// Scratch arrays for MSAD per-frame channel-bin views — `[target, ref0, ref1, ...]`.
		const msadFrameReals = new Array<Float32Array>(refCount + 1);
		const msadFrameImags = new Array<Float32Array>(refCount + 1);

		for (let ch = 0; ch < channels; ch++) {
			// --- Warm-up scan: per-reference H seed for this target channel ---
			const _twarm = _profStart();
			const seeds = await this.warmupSeedsForChannel(buffer, ch, warmupFrames, fftSize, hopSize);
			_profAdd("warmup", _twarm);

			// --- Allocate per-channel Kalman + MWF PSD state, seeded from warm-up ---
			const kalmanStates: Array<KalmanState> = seeds.map((seed) => createKalmanState(numBins, seed));
			const interfererPsd: InterfererPsdState = createInterfererPsdState(numBins);

			// --- MSAD: per-channel state for [target, ref0, ref1, ...] ---
			// Updated per frame across the whole channel pass. Drives
			// (a) Kalman gain shaping (target active → skip correction step) and
			// (b) interferer-speech-pause restoration per reference.
			const msadChannelStates: Array<MsadChannelState> = Array.from({ length: refCount + 1 }, () => createMsadChannelState(numBins));
			const ispStates: Array<IspState> = Array.from({ length: refCount }, () => createIspState(numBins));

			// --- Online process pass with carry ---
			// Iterates over the VIRTUAL signal (real audio padded by `edgePadSamples`
			// zeros at start and end). Read calls pass `edgePadSamples` so the helper
			// returns zeros for sample positions outside `[0, totalFrames)`.
			for (let outStart = 0; outStart < processStftFrames; outStart += chunkFrames) {
				const outFramesThisChunk = Math.min(chunkFrames, processStftFrames - outStart);
				const winStart = Math.max(0, outStart - carry);
				const winEnd = Math.min(processStftFrames, outStart + outFramesThisChunk + carry);
				const winFrames = winEnd - winStart;
				const winSamples = winFrames * hopSize + (fftSize - hopSize);

				const _tstft = _profStart();
				await readChunkIntoPadded(buffer, ch, winStart, winFrames, targetPadded, hopSize, fftSize, edgePadSamples);

				const targetStft = stft(targetPadded.subarray(0, winSamples), fftSize, hopSize, targetStftOutput, this.fftBackend, this.fftAddonOptions);

				const refStftsForChunk = new Array<StftOutput>(refCount);

				for (let refIndex = 0; refIndex < refCount; refIndex++) {
					await readChunkIntoPadded(referenceBuffers[refIndex]!, 0, winStart, winFrames, refPaddeds[refIndex]!, hopSize, fftSize, edgePadSamples);

					refStftsForChunk[refIndex] = stft(refPaddeds[refIndex]!.subarray(0, winSamples), fftSize, hopSize, refStftOutputs[refIndex], this.fftBackend, this.fftAddonOptions);
				}
				_profAdd("stftRead", _tstft);

				// Per-frame Stage 1 + Stage 2 update + mask compute.
				// Scratch buffers reused across frames for `Ŝ_m = W · Y_m` (the
				// pre-post-filter MWF output) so `updatePrevOutputPsd` can refresh
				// `Φ̂_ŜŜ(ℓ-1)` for next frame's dominant-bin construction.
				const sHatRe = new Float32Array(numBins);
				const sHatIm = new Float32Array(numBins);

				for (let frame = 0; frame < winFrames; frame++) {
					const frameOffset = frame * numBins;
					const frameReal = targetStft.real.subarray(frameOffset, frameOffset + numBins);
					const frameImag = targetStft.imag.subarray(frameOffset, frameOffset + numBins);

					for (let refIndex = 0; refIndex < refCount; refIndex++) {
						refFrameReals[refIndex] = refStftsForChunk[refIndex]!.real.subarray(frameOffset, frameOffset + numBins);
						refFrameImags[refIndex] = refStftsForChunk[refIndex]!.imag.subarray(frameOffset, frameOffset + numBins);
					}

					// --- Stage 0: MSAD per MEF §4.1 Eqs. 31–37 ---
					// Build the [target, ref0, ref1, ...] view for the multichannel SPR.
					msadFrameReals[0] = frameReal;
					msadFrameImags[0] = frameImag;

					for (let refIndex = 0; refIndex < refCount; refIndex++) {
						msadFrameReals[refIndex + 1] = refFrameReals[refIndex]!;
						msadFrameImags[refIndex + 1] = refFrameImags[refIndex]!;
					}

					const _tmsad = _profStart();
					const msadDecision = computeMsadDecision(msadFrameReals, msadFrameImags, msadChannelStates);
					_profAdd("msad", _tmsad);

					// --- Stage 1: FDAF Kalman update + combined-bleed prediction ---
					// `targetActive = true` short-circuits the correction step (skip
					// Eq. 18 + Eq. 22), preserving Ĥ at its prior value while target
					// speech dominates. Equivalent to MEF Eq. 23's Ψ^S inflation
					// driving Kalman gain → 0; the skip path is cleaner in code.
					const _tkal = _profStart();
					kalmanUpdateFrame(
						frameReal,
						frameImag,
						refFrameReals,
						refFrameImags,
						kalmanStates,
						kalmanParams,
						bleedTotalReal,
						bleedTotalImag,
						msadDecision.targetActive,
					);

					// --- Interferer-speech-pause restoration per MEF §4.1 ---
					// Per-reference: when an interferer transitions inactive→active
					// after ≥ 0.5 s of silence, restore the stored Kalman state for
					// that reference (avoids re-convergence drift). When active and
					// not transitioning, store the current state for the next pause.
					for (let refIndex = 0; refIndex < refCount; refIndex++) {
						applyIspRestoration(kalmanStates[refIndex]!, ispStates[refIndex]!, msadDecision.referenceActive[refIndex]!, ispThresholdFrames);
					}
					_profAdd("kalman", _tkal);

					// --- Stage 2: MWF — update interferer PSD then compute gain mask ---
					// Per MEF Eq. 28: Φ̂_DD smoothed from |D̂_m^total|².
					const _tmwf = _profStart();
					updateInterfererPsd(bleedTotalReal, bleedTotalImag, interfererPsd, mwfParams.temporalSmoothing);

					const maskFrame = rawMask.subarray(frameOffset, frameOffset + numBins);

					// MEF Eq. 25 Wiener form + Eq. 29 (bleed-pre-subtracted Φ̂_YY) +
					// Eq. 30 / §3.1.1 dominant-bin construction (Eqs. 4–8) for Φ̂_SS.
					// Reads `interfererPsd.prevOutputPsd` for `Φ̂_ŜŜ(ℓ-1)`.
					computeMwfMask(frameReal, frameImag, bleedTotalReal, bleedTotalImag, interfererPsd, mwfParams, MWF_EPSILON, maskFrame);

					// Refresh `Φ̂_ŜŜ(ℓ-1)` from this frame's MEF Eq. 2 MWF output
					// `Ŝ_m = W · Y_m`. The NLM+DFTT post-filter is applied later on
					// the whole window's mask; MEF's target-PSD construction only
					// references the Eq. 2 MWF output (pre-post-filter).
					for (let bin = 0; bin < numBins; bin++) {
						const gain = maskFrame[bin]!;

						sHatRe[bin] = gain * frameReal[bin]!;
						sHatIm[bin] = gain * frameImag[bin]!;
					}

					updatePrevOutputPsd(sHatRe, sHatIm, interfererPsd);
					_profAdd("mwf", _tmwf);
				}

				// --- Stage 3: NLM + DFTT smoothing of the gain mask (unchanged) ---
				const rawView = rawMask.subarray(0, winFrames * numBins);
				const nlmView = nlmMask.subarray(0, winFrames * numBins);
				const finalView = finalMask.subarray(0, winFrames * numBins);

				const _tnlm = _profStart();
				// pasteBlockSize=8 (was Lukin-Todd 4) per Phase 5.2 compute optimisation.
				// Cuts NLM cost by ~74% (16/64 of original work) and brings the
				// 60-s real-podcast render from 1.7× RT to 0.99× RT (Phase 5 goal).
				// Quality trade-off measured: wide-band reduction shifts from +0.07
				// to +0.26 dB vs RX (still well within Phase 3's 1 dB envelope);
				// per-band reduction shifts uniformly by +0.1 to +0.45 dB
				// (pattern preserved, structural shape unchanged from Phase 4
				// known-difference characterisation). See design-de-bleed.md
				// "2026-05-02: NLM pasteBlockSize=8 (Phase 5 1×-RT optimisation)".
				applyNlmSmoothing(
					rawView,
					winFrames,
					numBins,
					{
						patchSize: 8,
						searchFreqRadius: 8,
						searchTimePre: 16,
						searchTimePost: 4,
						pasteBlockSize: Number(process.env.DEBLEED_NLM_PASTE) || 8,
						threshold,
					},
					nlmView,
				);
				_profAdd("nlm", _tnlm);

				const _tdftt = _profStart();
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
				_profAdd("dftt", _tdftt);

				// --- Stage 4: apply mask to target STFT, iSTFT, write back ---
				const _tapp = _profStart();
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
				_profAdd("applyMaskIstft", _tapp);

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

				const _twrite = _profStart();
				const existingChunk = await buffer.read(clipStart, sliceLength);

				await buffer.write(clipStart, replaceChannel(existingChunk, ch, writeSamples, channels));
				_profAdd("write", _twrite);
			}
		}

		if (profileEnabled) {
			const total = profileMs.warmup + profileMs.stftRead + profileMs.msad + profileMs.kalman + profileMs.mwf + profileMs.nlm + profileMs.dftt + profileMs.applyMaskIstft + profileMs.write;
			const pct = (k: keyof typeof profileMs): string => `${(profileMs[k] / 1000).toFixed(2)}s (${((profileMs[k] / total) * 100).toFixed(1)}%)`;
			// eslint-disable-next-line no-console -- profile output is opt-in via env var
			console.log(`[deBleedAdaptive profile]
  warmup        : ${pct("warmup")}
  stft+read     : ${pct("stftRead")}
  msad          : ${pct("msad")}
  kalman+isp    : ${pct("kalman")}
  mwf           : ${pct("mwf")}
  nlm           : ${pct("nlm")}
  dftt          : ${pct("dftt")}
  applyMask+istft: ${pct("applyMaskIstft")}
  write         : ${pct("write")}
  TOTAL         : ${(total / 1000).toFixed(2)}s`);
		}
	}
}

export class DeBleedAdaptiveNode extends TransformNode<DeBleedAdaptiveProperties> {
	static override readonly moduleName = "De-Bleed Adaptive";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Adaptive (MEF FDAF Kalman + MWF + MSAD) reference-based microphone bleed reduction. Stages 1+2 are MEF Meyer-Elshamy-Fingscheidt 2020; Stage 3 is Lukin-Todd 2D NLM+DFTT post-filter.";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeBleedAdaptiveNode {
		return TransformNode.is(value) && value.type[2] === "de-bleed-adaptive";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-bleed-adaptive"] as const;

	constructor(properties: DeBleedAdaptiveProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): DeBleedAdaptiveStream {
		return new DeBleedAdaptiveStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeBleedAdaptiveProperties>): DeBleedAdaptiveNode {
		return new DeBleedAdaptiveNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deBleedAdaptive(
	references: string | ReadonlyArray<string>,
	options?: {
		reductionStrength?: number;
		artifactSmoothing?: number;
		adaptationSpeed?: number;
		fftSize?: number;
		hopSize?: number;
		vkfftAddonPath?: string;
		fftwAddonPath?: string;
		dfttBackend?: "" | "js" | "fftw" | "vkfft";
		id?: string;
	},
): DeBleedAdaptiveNode {
	const referencesArray = typeof references === "string" ? [references] : [...references];

	return new DeBleedAdaptiveNode({
		references: referencesArray,
		reductionStrength: options?.reductionStrength ?? 5,
		artifactSmoothing: options?.artifactSmoothing ?? 5,
		adaptationSpeed: options?.adaptationSpeed ?? 3,
		fftSize: options?.fftSize ?? 4096,
		hopSize: options?.hopSize ?? 1024,
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		dfttBackend: options?.dfttBackend ?? "",
		id: options?.id,
	});
}
