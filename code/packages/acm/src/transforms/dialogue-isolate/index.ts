import { ChunkBuffer } from "../../chunk-buffer";
import { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { z } from "zod";
import { highPassCoefficients, lowPassCoefficients, zeroPhaseBiquadFilter } from "../../utils/biquad";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { resampleDirect } from "../../utils/resample-direct";

export const schema = z.object({
	modelPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", accept: ".onnx", binary: "Kim_Vocal_2", download: "https://huggingface.co/seanghay/uvr_models" })
		.describe("MDX-Net vocal isolation model (.onnx)"),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	onnxAddonPath: z.string().default("").meta({ input: "file", mode: "open", binary: "onnx-addon", download: "https://github.com/visionsofparadise/onnx-runtime-addon" }).describe("ONNX Runtime native addon"),
	highPass: z.number().min(20).max(500).multipleOf(10).default(80).describe("High Pass"),
	lowPass: z.number().min(1000).max(22050).multipleOf(100).default(20000).describe("Low Pass"),
});

export interface DialogueIsolateProperties extends z.infer<typeof schema>, TransformModuleProperties {}

const SAMPLE_RATE = 44100;
const N_FFT = 7680;
const HOP_SIZE = 1024;
const DIM_F = 3072;
const DIM_T = 256;
const COMPENSATE = 1.009;
const NB_BINS = N_FFT / 2 + 1; // 3841
const SEGMENT_SAMPLES = N_FFT + (DIM_T - 1) * HOP_SIZE; // 268800
const OVERLAP = 0.25;
const TRANSITION_POWER = 1.0;
const CHANNEL_STRIDE = DIM_F * DIM_T;

export class DialogueIsolateModule extends TransformModule<DialogueIsolateProperties> {
	static override readonly moduleName = "Dialogue Isolate";
	static override readonly moduleDescription = "Isolate dialogue from background using MDX-Net vocal separation";
	static override readonly schema = schema;

	static override is(value: unknown): value is DialogueIsolateModule {
		return TransformModule.is(value) && value.type[2] === "dialogue-isolate";
	}

	override readonly type = ["async-module", "transform", "dialogue-isolate"] as const;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private session?: OnnxSession;
	private sourceSampleRate = SAMPLE_RATE;

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.sourceSampleRate = context.sampleRate;
		const onnxProviders = context.executionProviders.filter((p) => p !== "gpu" && p !== "cpu-native");
		this.session = await createOnnxSession(this.properties.onnxAddonPath, this.properties.modelPath, { executionProviders: onnxProviders.length > 0 ? onnxProviders : ["cpu"] });

		initMixedRadix();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.session) {
			throw new Error("DialogueIsolateModule not set up — ONNX session not initialized");
		}

		const frames = buffer.frames;
		const channels = buffer.channels;
		const chunk = await buffer.read(0, frames);

		const left = chunk.samples[0] ?? new Float32Array(frames);
		const right = channels >= 2 ? (chunk.samples[1] ?? left) : left;
		const isMono = left === right;

		// Resample to 44100Hz if needed
		let left44k = left;
		let right44k = right;

		if (this.sourceSampleRate !== SAMPLE_RATE) {
			const resampled = await resampleDirect(this.properties.ffmpegPath, [left, right], this.sourceSampleRate, SAMPLE_RATE);
			left44k = resampled[0] ?? left;
			right44k = resampled[1] ?? right;
		}

		const samples44k = left44k.length;

		// Process in overlapping segments
		const stride = Math.round((1 - OVERLAP) * SEGMENT_SAMPLES);
		const outputLeft = new Float32Array(samples44k);
		const outputRight = new Float32Array(samples44k);
		const sumWeight = new Float32Array(samples44k);

		// Triangle crossfade window
		const weight = new Float32Array(SEGMENT_SAMPLES);
		const half = SEGMENT_SAMPLES / 2;

		for (let index = 0; index < half; index++) {
			weight[index] = Math.pow((index + 1) / half, TRANSITION_POWER);
		}

		for (let index = 0; index < half; index++) {
			weight[SEGMENT_SAMPLES - 1 - index] = weight[index] ?? 0;
		}

		// Pre-allocate per-segment buffers
		const segLeft = new Float32Array(SEGMENT_SAMPLES);
		const segRight = new Float32Array(SEGMENT_SAMPLES);
		const inputData = new Float32Array(4 * CHANNEL_STRIDE);
		const segOutLeft = new Float32Array(SEGMENT_SAMPLES);
		const segOutRight = new Float32Array(SEGMENT_SAMPLES);
		const istftWindowSum = new Float32Array(SEGMENT_SAMPLES);

		for (let offset = 0; offset < samples44k; offset += stride) {
			const chunkLen = Math.min(SEGMENT_SAMPLES, samples44k - offset);

			// Extract segment (zero-pad if shorter)
			segLeft.fill(0);

			for (let index = 0; index < chunkLen; index++) {
				segLeft[index] = left44k[offset + index] ?? 0;
			}

			// STFT left channel → pack directly into tensor
			inputData.fill(0);
			stft7680IntoTensor(segLeft, inputData, 0 * CHANNEL_STRIDE, 2 * CHANNEL_STRIDE);

			if (isMono) {
				// Copy L data to R positions in tensor
				inputData.copyWithin(1 * CHANNEL_STRIDE, 0 * CHANNEL_STRIDE, 1 * CHANNEL_STRIDE);
				inputData.copyWithin(3 * CHANNEL_STRIDE, 2 * CHANNEL_STRIDE, 3 * CHANNEL_STRIDE);
			} else {
				segRight.fill(0);

				for (let index = 0; index < chunkLen; index++) {
					segRight[index] = right44k[offset + index] ?? 0;
				}

				stft7680IntoTensor(segRight, inputData, 1 * CHANNEL_STRIDE, 3 * CHANNEL_STRIDE);
			}

			// Run inference
			const result = this.session.run({
				input: { data: inputData, dims: [1, 4, DIM_F, DIM_T] },
			});

			const modelOutput = result.output;

			if (!modelOutput) continue;

			// iSTFT left channel from model output
			segOutLeft.fill(0);
			istftWindowSum.fill(0);
			istft7680FromTensor(modelOutput.data, 0 * CHANNEL_STRIDE, 2 * CHANNEL_STRIDE, DIM_T, COMPENSATE, segOutLeft, istftWindowSum);

			if (isMono) {
				segOutRight.set(segOutLeft);
			} else {
				segOutRight.fill(0);
				istftWindowSum.fill(0);
				istft7680FromTensor(modelOutput.data, 1 * CHANNEL_STRIDE, 3 * CHANNEL_STRIDE, DIM_T, COMPENSATE, segOutRight, istftWindowSum);
			}

			// Accumulate with crossfade
			for (let index = 0; index < chunkLen; index++) {
				const wt = weight[index] ?? 1;
				outputLeft[offset + index] = (outputLeft[offset + index] ?? 0) + (segOutLeft[index] ?? 0) * wt;
				outputRight[offset + index] = (outputRight[offset + index] ?? 0) + (segOutRight[index] ?? 0) * wt;
				sumWeight[offset + index] = (sumWeight[offset + index] ?? 0) + wt;
			}
		}

		// Normalize by weights
		for (let index = 0; index < samples44k; index++) {
			const sw = sumWeight[index] ?? 1;

			if (sw > 0) {
				outputLeft[index] = (outputLeft[index] ?? 0) / sw;
				outputRight[index] = (outputRight[index] ?? 0) / sw;
			}
		}

		// Resample back to original sample rate if needed
		let finalLeft: Float32Array = outputLeft;
		let finalRight: Float32Array = outputRight;

		if (this.sourceSampleRate !== SAMPLE_RATE) {
			const resampled = await resampleDirect(this.properties.ffmpegPath, [outputLeft, outputRight], SAMPLE_RATE, this.sourceSampleRate);
			finalLeft = resampled[0] ?? outputLeft;
			finalRight = resampled[1] ?? outputRight;
		}

		// Build output channels
		const outputChannels: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const out = new Float32Array(frames);
			const srcCh = Math.min(ch, 1);
			const src = srcCh === 0 ? finalLeft : finalRight;
			out.set(src.subarray(0, Math.min(src.length, frames)));
			outputChannels.push(out);
		}

		// Apply optional bandpass filter
		const { highPass, lowPass } = this.properties;

		if (highPass || lowPass) {
			for (const channel of outputChannels) {
				if (highPass) {
					zeroPhaseBiquadFilter(channel, highPassCoefficients(this.sourceSampleRate, highPass));
				}

				if (lowPass) {
					zeroPhaseBiquadFilter(channel, lowPassCoefficients(this.sourceSampleRate, lowPass));
				}
			}
		}

		await buffer.write(0, outputChannels);
	}

	protected override _teardown(): void {
		this.session?.dispose();
		this.session = undefined;
	}

	clone(overrides?: Partial<DialogueIsolateProperties>): DialogueIsolateModule {
		return new DialogueIsolateModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function dialogueIsolate(options: {
	modelPath: string;
	ffmpegPath: string;
	onnxAddonPath?: string;
	highPass?: number;
	lowPass?: number;
	id?: string;
}): DialogueIsolateModule {
	return new DialogueIsolateModule({
		modelPath: options.modelPath,
		ffmpegPath: options.ffmpegPath,
		onnxAddonPath: options.onnxAddonPath ?? "",
		highPass: options.highPass ?? 80,
		lowPass: options.lowPass ?? 20000,
		id: options.id,
	});
}

// --- STFT/iSTFT with direct tensor packing ---

function stft7680IntoTensor(signal: Float32Array, tensor: Float32Array, realOffset: number, imagOffset: number): void {
	const win = periodicHannWindow7680(N_FFT);
	const windowed = fftFrameRe;
	const zeros = fftFrameIm;
	const outRe = fftOutRe;
	const outIm = fftOutIm;

	zeros.fill(0);

	let frame = 0;

	for (let start = 0; start + N_FFT <= signal.length; start += HOP_SIZE) {
		for (let index = 0; index < N_FFT; index++) {
			windowed[index] = (signal[start + index] ?? 0) * (win[index] ?? 0);
		}

		mixedRadixFft7680(windowed, zeros, outRe, outIm);

		// Pack first DIM_F bins directly into tensor
		for (let freq = 0; freq < DIM_F; freq++) {
			tensor[realOffset + freq * DIM_T + frame] = outRe[freq] ?? 0;
			tensor[imagOffset + freq * DIM_T + frame] = outIm[freq] ?? 0;
		}

		frame++;
	}
}

function istft7680FromTensor(tensor: Float32Array, realOffset: number, imagOffset: number, numFrames: number, scale: number, output: Float32Array, windowSum: Float32Array): void {
	const win = periodicHannWindow7680(N_FFT);
	const fullRe = fftFrameRe;
	const fullIm = fftFrameIm;
	const outRe = fftOutRe;
	const outIm = fftOutIm;
	const outputLength = output.length;

	for (let frame = 0; frame < numFrames; frame++) {
		// Read DIM_F bins from tensor, scale, zero-pad to N_FFT with conjugate symmetry
		fullRe.fill(0);
		fullIm.fill(0);

		for (let freq = 0; freq < DIM_F; freq++) {
			fullRe[freq] = (tensor[realOffset + freq * DIM_T + frame] ?? 0) * scale;
			fullIm[freq] = (tensor[imagOffset + freq * DIM_T + frame] ?? 0) * scale;
		}

		// Bins DIM_F..NB_BINS-1 remain zero
		// Conjugate symmetry for bins NB_BINS..N_FFT-1
		for (let index = 1; index < NB_BINS - 1; index++) {
			fullRe[N_FFT - index] = fullRe[index] ?? 0;
			fullIm[N_FFT - index] = -(fullIm[index] ?? 0);
		}

		mixedRadixIfft7680(fullRe, fullIm, outRe, outIm);

		const frameOffset = frame * HOP_SIZE;

		for (let index = 0; index < N_FFT; index++) {
			const pos = frameOffset + index;

			if (pos < outputLength) {
				const wt = win[index] ?? 0;
				output[pos] = (output[pos] ?? 0) + (outRe[index] ?? 0) * wt;
				windowSum[pos] = (windowSum[pos] ?? 0) + wt * wt;
			}
		}
	}

	// Normalize by window sum
	for (let index = 0; index < outputLength; index++) {
		const ws = windowSum[index] ?? 0;

		if (ws > 1e-8) {
			output[index] = (output[index] ?? 0) / ws;
		}
	}
}

// --- Mixed-radix FFT for 7680-point transforms ---
// 7680 = 2^9 × 3 × 5 — uses Cooley-Tukey decimation-in-time with radix-2, radix-3, and radix-5 butterflies.
// Factorization order (innermost to outermost): [5, 3, 512] where 512 = 2^9.

// Pre-computed radix factorization of N_FFT
const RADICES = [5, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2]; // product = 7680

let fftFrameRe: Float32Array;
let fftFrameIm: Float32Array;
let fftOutRe: Float32Array;
let fftOutIm: Float32Array;
let fftAuxIm: Float32Array;
let mixedRadixPermutation: Uint16Array;
let mixedRadixTwiddleRe: Float32Array;
let mixedRadixTwiddleIm: Float32Array;
let mixedRadixInitialized = false;

function initMixedRadix(): void {
	if (mixedRadixInitialized) return;
	mixedRadixInitialized = true;

	// Work buffers
	fftFrameRe = new Float32Array(N_FFT);
	fftFrameIm = new Float32Array(N_FFT);
	fftOutRe = new Float32Array(N_FFT);
	fftOutIm = new Float32Array(N_FFT);
	fftAuxIm = new Float32Array(N_FFT);

	// Pre-compute bit-reversal permutation for mixed radix
	mixedRadixPermutation = new Uint16Array(N_FFT);

	for (let index = 0; index < N_FFT; index++) {
		let remainder = index;
		let permuted = 0;
		let base = N_FFT;

		for (const radix of RADICES) {
			base = base / radix;
			const digit = remainder % radix;
			remainder = Math.floor(remainder / radix);
			permuted += digit * base;
		}

		mixedRadixPermutation[index] = permuted;
	}

	// Pre-compute twiddle factors for all stages
	// Each stage has N_FFT twiddle factor lookups (worst case), but we store per-stage
	// For stage with groupSize g and radix r: need twiddle exp(-j*2*pi*k*n/g) for k=0..r-1, n=0..g/r-1
	// Total factors across all stages: sum over stages of (radix-1) * (groupSize/radix)
	// We store them flat: for each stage, for each sub-butterfly position
	let totalTwiddles = 0;

	{
		let groupSize = 1;

		for (const radix of RADICES) {
			groupSize *= radix;
			totalTwiddles += (radix - 1) * (groupSize / radix);
		}
	}

	mixedRadixTwiddleRe = new Float32Array(totalTwiddles);
	mixedRadixTwiddleIm = new Float32Array(totalTwiddles);

	let twOffset = 0;
	let groupSize = 1;

	for (const radix of RADICES) {
		groupSize *= radix;
		const subSize = groupSize / radix;

		for (let kk = 1; kk < radix; kk++) {
			for (let nn = 0; nn < subSize; nn++) {
				const angle = (-2 * Math.PI * kk * nn) / groupSize;
				mixedRadixTwiddleRe[twOffset] = Math.cos(angle);
				mixedRadixTwiddleIm[twOffset] = Math.sin(angle);
				twOffset++;
			}
		}
	}
}

function mixedRadixFft7680(xRe: Float32Array, xIm: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
	const perm = mixedRadixPermutation;

	// Apply digit-reversal permutation
	for (let index = 0; index < N_FFT; index++) {
		const pp = perm[index] ?? 0;
		outRe[index] = xRe[pp] ?? 0;
		outIm[index] = xIm[pp] ?? 0;
	}

	let groupSize = 1;
	let twOffset = 0;

	for (const radix of RADICES) {
		groupSize *= radix;
		const subSize = groupSize / radix;

		if (radix === 2) {
			// Radix-2 butterfly
			for (let group = 0; group < N_FFT; group += groupSize) {
				for (let nn = 0; nn < subSize; nn++) {
					const idx0 = group + nn;
					const idx1 = idx0 + subSize;

					const twRe = nn === 0 ? 1 : (mixedRadixTwiddleRe[twOffset + nn - 1] ?? 0);
					const twIm = nn === 0 ? 0 : (mixedRadixTwiddleIm[twOffset + nn - 1] ?? 0);

					const tRe = (outRe[idx1] ?? 0) * twRe - (outIm[idx1] ?? 0) * twIm;
					const tIm = (outRe[idx1] ?? 0) * twIm + (outIm[idx1] ?? 0) * twRe;

					outRe[idx1] = (outRe[idx0] ?? 0) - tRe;
					outIm[idx1] = (outIm[idx0] ?? 0) - tIm;
					outRe[idx0] = (outRe[idx0] ?? 0) + tRe;
					outIm[idx0] = (outIm[idx0] ?? 0) + tIm;
				}
			}

			twOffset += subSize - 1;
		} else if (radix === 3) {
			// Radix-3 butterfly
			const c3 = -0.5; // cos(2pi/3)
			const s3 = -Math.sqrt(3) / 2; // sin(2pi/3) with negative sign for DFT convention

			for (let group = 0; group < N_FFT; group += groupSize) {
				for (let nn = 0; nn < subSize; nn++) {
					const idx0 = group + nn;
					const idx1 = idx0 + subSize;
					const idx2 = idx0 + 2 * subSize;

					// Twiddle factors: W^(k*nn) for k=1,2
					let tw1Re: number, tw1Im: number, tw2Re: number, tw2Im: number;

					if (nn === 0) {
						tw1Re = 1;
						tw1Im = 0;
						tw2Re = 1;
						tw2Im = 0;
					} else {
						tw1Re = mixedRadixTwiddleRe[twOffset + nn - 1] ?? 0;
						tw1Im = mixedRadixTwiddleIm[twOffset + nn - 1] ?? 0;
						tw2Re = mixedRadixTwiddleRe[twOffset + subSize - 1 + nn - 1] ?? 0;
						tw2Im = mixedRadixTwiddleIm[twOffset + subSize - 1 + nn - 1] ?? 0;
					}

					// Apply twiddles
					const x1Re = (outRe[idx1] ?? 0) * tw1Re - (outIm[idx1] ?? 0) * tw1Im;
					const x1Im = (outRe[idx1] ?? 0) * tw1Im + (outIm[idx1] ?? 0) * tw1Re;
					const x2Re = (outRe[idx2] ?? 0) * tw2Re - (outIm[idx2] ?? 0) * tw2Im;
					const x2Im = (outRe[idx2] ?? 0) * tw2Im + (outIm[idx2] ?? 0) * tw2Re;

					const x0Re = outRe[idx0] ?? 0;
					const x0Im = outIm[idx0] ?? 0;

					// 3-point DFT
					const sumRe = x1Re + x2Re;
					const sumIm = x1Im + x2Im;
					const diffRe = x1Re - x2Re;
					const diffIm = x1Im - x2Im;

					outRe[idx0] = x0Re + sumRe;
					outIm[idx0] = x0Im + sumIm;
					outRe[idx1] = x0Re + c3 * sumRe - s3 * diffIm;
					outIm[idx1] = x0Im + c3 * sumIm + s3 * diffRe;
					outRe[idx2] = x0Re + c3 * sumRe + s3 * diffIm;
					outIm[idx2] = x0Im + c3 * sumIm - s3 * diffRe;
				}
			}

			twOffset += 2 * (subSize - 1);
		} else if (radix === 5) {
			// Radix-5 butterfly using the standard DFT matrix approach
			const cos1 = Math.cos((2 * Math.PI) / 5); // cos(72°)
			const cos2 = Math.cos((4 * Math.PI) / 5); // cos(144°)
			const sin1 = -Math.sin((2 * Math.PI) / 5); // -sin(72°) for DFT convention
			const sin2 = -Math.sin((4 * Math.PI) / 5); // -sin(144°) for DFT convention

			for (let group = 0; group < N_FFT; group += groupSize) {
				for (let nn = 0; nn < subSize; nn++) {
					const idx0 = group + nn;
					const idx1 = idx0 + subSize;
					const idx2 = idx0 + 2 * subSize;
					const idx3 = idx0 + 3 * subSize;
					const idx4 = idx0 + 4 * subSize;

					// Twiddle factors: W^(k*nn) for k=1,2,3,4
					let tw1Re: number, tw1Im: number;
					let tw2Re: number, tw2Im: number;
					let tw3Re: number, tw3Im: number;
					let tw4Re: number, tw4Im: number;

					if (nn === 0) {
						tw1Re = 1;
						tw1Im = 0;
						tw2Re = 1;
						tw2Im = 0;
						tw3Re = 1;
						tw3Im = 0;
						tw4Re = 1;
						tw4Im = 0;
					} else {
						tw1Re = mixedRadixTwiddleRe[twOffset + nn - 1] ?? 0;
						tw1Im = mixedRadixTwiddleIm[twOffset + nn - 1] ?? 0;
						tw2Re = mixedRadixTwiddleRe[twOffset + subSize - 1 + nn - 1] ?? 0;
						tw2Im = mixedRadixTwiddleIm[twOffset + subSize - 1 + nn - 1] ?? 0;
						tw3Re = mixedRadixTwiddleRe[twOffset + 2 * (subSize - 1) + nn - 1] ?? 0;
						tw3Im = mixedRadixTwiddleIm[twOffset + 2 * (subSize - 1) + nn - 1] ?? 0;
						tw4Re = mixedRadixTwiddleRe[twOffset + 3 * (subSize - 1) + nn - 1] ?? 0;
						tw4Im = mixedRadixTwiddleIm[twOffset + 3 * (subSize - 1) + nn - 1] ?? 0;
					}

					// Apply twiddles
					const x0Re = outRe[idx0] ?? 0;
					const x0Im = outIm[idx0] ?? 0;
					const x1Re = (outRe[idx1] ?? 0) * tw1Re - (outIm[idx1] ?? 0) * tw1Im;
					const x1Im = (outRe[idx1] ?? 0) * tw1Im + (outIm[idx1] ?? 0) * tw1Re;
					const x2Re = (outRe[idx2] ?? 0) * tw2Re - (outIm[idx2] ?? 0) * tw2Im;
					const x2Im = (outRe[idx2] ?? 0) * tw2Im + (outIm[idx2] ?? 0) * tw2Re;
					const x3Re = (outRe[idx3] ?? 0) * tw3Re - (outIm[idx3] ?? 0) * tw3Im;
					const x3Im = (outRe[idx3] ?? 0) * tw3Im + (outIm[idx3] ?? 0) * tw3Re;
					const x4Re = (outRe[idx4] ?? 0) * tw4Re - (outIm[idx4] ?? 0) * tw4Im;
					const x4Im = (outRe[idx4] ?? 0) * tw4Im + (outIm[idx4] ?? 0) * tw4Re;

					// 5-point DFT using Rader/Winograd-style reduction
					const sum14Re = x1Re + x4Re;
					const sum14Im = x1Im + x4Im;
					const diff14Re = x1Re - x4Re;
					const diff14Im = x1Im - x4Im;
					const sum23Re = x2Re + x3Re;
					const sum23Im = x2Im + x3Im;
					const diff23Re = x2Re - x3Re;
					const diff23Im = x2Im - x3Im;

					outRe[idx0] = x0Re + sum14Re + sum23Re;
					outIm[idx0] = x0Im + sum14Im + sum23Im;

					outRe[idx1] = x0Re + cos1 * sum14Re + cos2 * sum23Re - sin1 * diff14Im - sin2 * diff23Im;
					outIm[idx1] = x0Im + cos1 * sum14Im + cos2 * sum23Im + sin1 * diff14Re + sin2 * diff23Re;

					outRe[idx2] = x0Re + cos2 * sum14Re + cos1 * sum23Re - sin2 * diff14Im + sin1 * diff23Im;
					outIm[idx2] = x0Im + cos2 * sum14Im + cos1 * sum23Im + sin2 * diff14Re - sin1 * diff23Re;

					outRe[idx3] = x0Re + cos2 * sum14Re + cos1 * sum23Re + sin2 * diff14Im - sin1 * diff23Im;
					outIm[idx3] = x0Im + cos2 * sum14Im + cos1 * sum23Im - sin2 * diff14Re + sin1 * diff23Re;

					outRe[idx4] = x0Re + cos1 * sum14Re + cos2 * sum23Re + sin1 * diff14Im + sin2 * diff23Im;
					outIm[idx4] = x0Im + cos1 * sum14Im + cos2 * sum23Im - sin1 * diff14Re - sin2 * diff23Re;
				}
			}

			twOffset += 4 * (subSize - 1);
		}
	}
}

function mixedRadixIfft7680(xRe: Float32Array, xIm: Float32Array, outRe: Float32Array, outIm: Float32Array): void {
	const auxIm = fftAuxIm;

	// Conjugate input imaginary
	for (let index = 0; index < N_FFT; index++) {
		auxIm[index] = -(xIm[index] ?? 0);
	}

	// Forward FFT of conjugated input
	mixedRadixFft7680(xRe, auxIm, outRe, outIm);

	// Conjugate output and divide by N
	for (let index = 0; index < N_FFT; index++) {
		outRe[index] = (outRe[index] ?? 0) / N_FFT;
		outIm[index] = -(outIm[index] ?? 0) / N_FFT;
	}
}

// --- Windowing ---

const periodicHannCache7680 = new Map<number, Float32Array>();

function periodicHannWindow7680(size: number): Float32Array {
	const cached = periodicHannCache7680.get(size);

	if (cached) return cached;

	const win = new Float32Array(size);

	for (let index = 0; index < size; index++) {
		win[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
	}

	periodicHannCache7680.set(size, win);

	return win;
}
