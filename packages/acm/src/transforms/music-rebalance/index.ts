import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { dbToLinear } from "../../utils/db";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";

export interface StemGains {
	readonly vocals: number;
	readonly drums: number;
	readonly bass: number;
	readonly other: number;
}

export interface MusicRebalanceProperties extends TransformModuleProperties {
	readonly modelPath: string;
	readonly stems: StemGains;
	readonly highPass?: number;
	readonly lowPass?: number;
}

const FFT_SIZE = 4096;
const HOP_SIZE = 1024;
const SEGMENT_SAMPLES = 343980; // 7.8s at 44100Hz
const OVERLAP = 0.25;
const TRANSITION_POWER = 1.0;

export class MusicRebalanceModule extends TransformModule {
	static override is(value: unknown): value is MusicRebalanceModule {
		return TransformModule.is(value) && value.type[2] === "music-rebalance";
	}

	readonly type = ["async-module", "transform", "music-rebalance"] as const;
	readonly properties: MusicRebalanceProperties;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private session?: OnnxSession;

	constructor(properties: AudioChainModuleInput<MusicRebalanceProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);
		this.session = await createOnnxSession(this.properties.modelPath);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.session) {
			throw new Error("MusicRebalanceTransformModule not set up — ONNX session not initialized");
		}

		const frames = buffer.frames;
		const channels = buffer.channels;
		const chunk = await buffer.read(0, frames);

		// Get stereo input (duplicate mono if needed)
		const left = chunk.samples[0] ?? new Float32Array(frames);
		const right = channels >= 2 ? (chunk.samples[1] ?? left) : left;

		// Normalize: subtract mean, divide by std
		const stereo = new Float32Array(2 * frames);

		stereo.set(left, 0);
		stereo.set(right, frames);

		let sum = 0;

		for (const sample of stereo) {
			sum += sample;
		}

		const mean = sum / stereo.length;
		let variance = 0;

		for (const sample of stereo) {
			const diff = sample - mean;
			variance += diff * diff;
		}

		const std = Math.sqrt(variance / stereo.length) || 1;

		const normalizedLeft = new Float32Array(frames);
		const normalizedRight = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			normalizedLeft[index] = ((left[index] ?? 0) - mean) / std;
			normalizedRight[index] = ((right[index] ?? 0) - mean) / std;
		}

		// Process in overlapping segments
		const stridesamples = Math.round((1 - OVERLAP) * SEGMENT_SAMPLES);
		const stemOutputs = new Array<Float32Array>(4 * 2);

		for (let si = 0; si < 8; si++) {
			stemOutputs[si] = new Float32Array(frames);
		}

		const sumWeight = new Float32Array(frames);

		// Triangle crossfade window
		const weight = new Float32Array(SEGMENT_SAMPLES);
		const half = SEGMENT_SAMPLES / 2;

		for (let index = 0; index < half; index++) {
			weight[index] = Math.pow((index + 1) / half, TRANSITION_POWER);
		}

		for (let index = 0; index < half; index++) {
			weight[SEGMENT_SAMPLES - 1 - index] = weight[index] ?? 0;
		}

			// Pre-allocate segment buffers (constant sizes across all segments)
		const pad = Math.floor(HOP_SIZE / 2) * 3; // 1536
		const le = Math.ceil(SEGMENT_SAMPLES / HOP_SIZE);
		const padEnd = pad + le * HOP_SIZE - SEGMENT_SAMPLES;
		const paddedLen = SEGMENT_SAMPLES + pad + padEnd;
		const stftPadConst = FFT_SIZE / 2;
		const stftLenConst = paddedLen + FFT_SIZE;
		const nbBinsConst = FFT_SIZE / 2 + 1;
		const nbFramesConst = Math.floor((stftLenConst - FFT_SIZE) / HOP_SIZE) + 1;
		const xBinsConst = nbBinsConst - 1;
		const xFramesConst = nbFramesConst - 4;

		const segLeft = new Float32Array(SEGMENT_SAMPLES);
		const segRight = new Float32Array(SEGMENT_SAMPLES);
		const inputData = new Float32Array(2 * SEGMENT_SAMPLES);
		const xData = new Float32Array(4 * xBinsConst * xFramesConst);

		// Pre-allocate per-stem frequency arrays (reused across stem-channel iterations)
		const freqRealBuffers: Array<Float32Array> = [];
		const freqImagBuffers: Array<Float32Array> = [];

		for (let frame = 0; frame < nbFramesConst; frame++) {
			freqRealBuffers.push(new Float32Array(nbBinsConst));
			freqImagBuffers.push(new Float32Array(nbBinsConst));
		}

		for (let segmentOffset = 0; segmentOffset < frames; segmentOffset += stridesamples) {
			const chunkLength = Math.min(SEGMENT_SAMPLES, frames - segmentOffset);

			// Extract segment (zero-pad if shorter than SEGMENT_SAMPLES)
			segLeft.fill(0);
			segRight.fill(0);

			for (let index = 0; index < chunkLength; index++) {
				segLeft[index] = normalizedLeft[segmentOffset + index] ?? 0;
				segRight[index] = normalizedRight[segmentOffset + index] ?? 0;
			}

			const paddedLeft = reflectPad(segLeft, pad, padEnd, paddedLen);
			const paddedRight = reflectPad(segRight, pad, padEnd, paddedLen);

			// Compute STFT for both channels
			const stftInputLeft = reflectPad(paddedLeft, stftPadConst, stftPadConst, stftLenConst);
			const stftInputRight = reflectPad(paddedRight, stftPadConst, stftPadConst, stftLenConst);
			const stftLeft = computeStft(stftInputLeft);
			const stftRight = computeStft(stftInputRight);

			// Build x tensor: complex-as-channels [1, 4, 2048, nbFrames-4]
			xData.fill(0);

			for (let ch = 0; ch < 2; ch++) {
				const stftCh = ch === 0 ? stftLeft : stftRight;

				for (let freq = 0; freq < xBinsConst; freq++) {
					for (let frame = 0; frame < xFramesConst; frame++) {
						const realIdx = 2 * ch * xBinsConst * xFramesConst + freq * xFramesConst + frame;
						const imagIdx = (2 * ch + 1) * xBinsConst * xFramesConst + freq * xFramesConst + frame;
						const srcFrame = frame + 2;

						xData[realIdx] = stftCh.real[srcFrame]?.[freq] ?? 0;
						xData[imagIdx] = stftCh.imag[srcFrame]?.[freq] ?? 0;
					}
				}
			}

			// Build input tensor: [1, 2, SEGMENT_SAMPLES]
			inputData.set(segLeft, 0);
			inputData.set(segRight, SEGMENT_SAMPLES);

			// Run inference
			const result = await this.session.run({
				input: { data: inputData, dims: [1, 2, SEGMENT_SAMPLES] },
				x: { data: xData, dims: [1, 4, xBinsConst, xFramesConst] },
			});

			// Extract time-branch output: add_67 [1, 4, 2, SEGMENT_SAMPLES]
			const xtOut = result.add_67 ?? result[Object.keys(result).pop() ?? ""];

			// Extract freq-branch output: output [1, 4, 4, 2048, xFrames]
			const xOut = result.output ?? result[Object.keys(result)[0] ?? ""];

			// Process each source: iSTFT the freq branch + add time branch
			for (let source = 0; source < 4; source++) {
				for (let ch = 0; ch < 2; ch++) {
					// Time branch component
					const xtIndex = source * 2 * SEGMENT_SAMPLES + ch * SEGMENT_SAMPLES;

					// Zero freq buffers for reuse
					for (let frame = 0; frame < nbFramesConst; frame++) {
						freqRealBuffers[frame]?.fill(0);
						freqImagBuffers[frame]?.fill(0);
					}

					// Unpack CaC from x_out [1, 4, 4, xBins, xFrames]
					if (xOut) {
						const srcCh = ch; // 0 or 1
						const baseOffset = source * 4 * xBinsConst * xFramesConst;

						for (let freq = 0; freq < xBinsConst; freq++) {
							for (let frame = 0; frame < xFramesConst; frame++) {
								const realIdx = baseOffset + 2 * srcCh * xBinsConst * xFramesConst + freq * xFramesConst + frame;
								const imagIdx = baseOffset + (2 * srcCh + 1) * xBinsConst * xFramesConst + freq * xFramesConst + frame;
								const destFrame = frame + 2;
								const realArr = freqRealBuffers[destFrame];
								const imagArr = freqImagBuffers[destFrame];

								if (realArr && imagArr) {
									realArr[freq] = xOut.data[realIdx] ?? 0;
									imagArr[freq] = xOut.data[imagIdx] ?? 0;
								}
							}
						}
					}

					const freqWaveform = computeIstft(freqRealBuffers, freqImagBuffers, FFT_SIZE, HOP_SIZE, stftLenConst);

					// Sum time + freq branches, accumulate with crossfade
					const freqOffset = stftPadConst + pad;

					for (let index = 0; index < chunkLength; index++) {
						const timeVal = xtOut ? (xtOut.data[xtIndex + index] ?? 0) : 0;
						const freqVal = freqWaveform[freqOffset + index] ?? 0;
						const combined = timeVal + freqVal;
						const wt = weight[index] ?? 1;

						const outIdx = source * 2 + ch;
						const arr = stemOutputs[outIdx];

						if (arr) {
							arr[segmentOffset + index] = (arr[segmentOffset + index] ?? 0) + combined * wt;
						}
					}
				}
			}

			// Accumulate weights
			for (let index = 0; index < chunkLength; index++) {
				sumWeight[segmentOffset + index] = (sumWeight[segmentOffset + index] ?? 0) + (weight[index] ?? 0);
			}
		}

		// Normalize by weights and denormalize
		const { stems } = this.properties;
		const stemGains = [stems.drums, stems.bass, stems.other, stems.vocals];
		const outputChannels: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const output = new Float32Array(frames);
			const srcCh = Math.min(ch, 1); // map to stereo

			for (let index = 0; index < frames; index++) {
				const sw = sumWeight[index] ?? 1;
				let normalizedSum = 0;

				for (let source = 0; source < 4; source++) {
					const gain = stemGains[source] ?? 1;

					if (gain === 0) continue;

					const arr = stemOutputs[source * 2 + srcCh];
					normalizedSum += (arr ? (arr[index] ?? 0) / sw : 0) * gain;
				}

				// Denormalize once after summing all stems
				output[index] = normalizedSum * std + mean;
			}

			outputChannels.push(output);
		}

		// Apply optional bandpass cleanup
		const { highPass, lowPass } = this.properties;

		if (highPass || lowPass) {
			const sampleRate = 44100; // htdemucs operates at 44100

			for (const channel of outputChannels) {
				if (highPass) {
					applyBiquadFilter(channel, sampleRate, highPass, "highpass");
				}

				if (lowPass) {
					applyBiquadFilter(channel, sampleRate, lowPass, "lowpass");
				}
			}
		}

		await buffer.write(0, outputChannels);
	}

	protected override _teardown(): void {
		this.session?.dispose();
		this.session = undefined;
	}

	clone(overrides?: Partial<MusicRebalanceProperties>): MusicRebalanceModule {
		return new MusicRebalanceModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function musicRebalance(
	modelPath: string,
	stems: Partial<StemGains>,
	options?: {
		id?: string;
	},
): MusicRebalanceModule {
	return new MusicRebalanceModule({
		modelPath,
		stems: {
			vocals: stems.vocals ?? 1,
			drums: stems.drums ?? 1,
			bass: stems.bass ?? 1,
			other: stems.other ?? 1,
		},
		id: options?.id,
	});
}

// --- DSP helpers ---

function reflectPad(signal: Float32Array, padLeft: number, padRight: number, totalLen: number): Float32Array {
	const result = new Float32Array(totalLen);

	// Copy signal into center
	result.set(signal, padLeft);

	// Reflect left
	for (let index = 0; index < padLeft; index++) {
		result[padLeft - 1 - index] = result[padLeft + index] ?? 0;
	}

	// Reflect right
	const signalEnd = padLeft + signal.length - 1;

	for (let index = 0; index < padRight; index++) {
		result[signalEnd + index + 1] = result[signalEnd - index] ?? 0;
	}

	return result;
}

const periodicHannCache = new Map<number, Float32Array>();

function periodicHannWindow(size: number): Float32Array {
	const cached = periodicHannCache.get(size);

	if (cached) return cached;

	const window = new Float32Array(size);

	for (let index = 0; index < size; index++) {
		window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
	}

	periodicHannCache.set(size, window);

	return window;
}

interface ComplexStft {
	real: Array<Float32Array>;
	imag: Array<Float32Array>;
}

function computeStft(signal: Float32Array): ComplexStft {
	const window = periodicHannWindow(FFT_SIZE);
	const scale = 1 / Math.sqrt(FFT_SIZE);
	const real: Array<Float32Array> = [];
	const imag: Array<Float32Array> = [];
	const nbBins = FFT_SIZE / 2 + 1;
	const windowed = new Float32Array(FFT_SIZE);
	const fftRe = new Float32Array(FFT_SIZE);
	const fftIm = new Float32Array(FFT_SIZE);

	for (let start = 0; start + FFT_SIZE <= signal.length; start += HOP_SIZE) {

		for (let index = 0; index < FFT_SIZE; index++) {
			windowed[index] = (signal[start + index] ?? 0) * (window[index] ?? 0);
		}

		const { re, im } = fftForward(windowed, fftRe, fftIm);
		const frameReal = new Float32Array(nbBins);
		const frameImag = new Float32Array(nbBins);

		for (let index = 0; index < nbBins; index++) {
			frameReal[index] = (re[index] ?? 0) * scale;
			frameImag[index] = (im[index] ?? 0) * scale;
		}

		real.push(frameReal);
		imag.push(frameImag);
	}

	return { real, imag };
}

function computeIstft(real: Array<Float32Array>, imag: Array<Float32Array>, fftSize: number, hopSize: number, outputLength: number): Float32Array {
	const window = periodicHannWindow(fftSize);
	const scale = Math.sqrt(fftSize);
	const output = new Float32Array(outputLength);
	const windowSum = new Float32Array(outputLength);
	const nbBins = fftSize / 2 + 1;
	const fullRe = new Float32Array(fftSize);
	const fullIm = new Float32Array(fftSize);
	const ifftOutRe = new Float32Array(fftSize);
	const ifftOutIm = new Float32Array(fftSize);

	for (let frame = 0; frame < real.length; frame++) {
		const re = real[frame];
		const im = imag[frame];

		if (!re || !im) continue;

		// Reconstruct full spectrum
		fullRe.fill(0);
		fullIm.fill(0);

		for (let index = 0; index < nbBins; index++) {
			fullRe[index] = (re[index] ?? 0) * scale;
			fullIm[index] = (im[index] ?? 0) * scale;
		}

		for (let index = 1; index < nbBins - 1; index++) {
			fullRe[fftSize - index] = fullRe[index] ?? 0;
			fullIm[fftSize - index] = -(fullIm[index] ?? 0);
		}

		const timeDomain = fftInverse(fullRe, fullIm, ifftOutRe, ifftOutIm);
		const offset = frame * hopSize;

		for (let index = 0; index < fftSize; index++) {
			const pos = offset + index;

			if (pos < outputLength) {
				const wv = window[index] ?? 0;
				output[pos] = (output[pos] ?? 0) + ((timeDomain[index] ?? 0) * wv) / fftSize;
				windowSum[pos] = (windowSum[pos] ?? 0) + wv * wv;
			}
		}
	}

	for (let index = 0; index < outputLength; index++) {
		const ws = windowSum[index] ?? 0;

		if (ws > 1e-8) {
			output[index] = (output[index] ?? 0) / ws;
		}
	}

	return output;
}

// --- Minimal FFT implementation ---

function fftForward(input: Float32Array, wRe?: Float32Array, wIm?: Float32Array): { re: Float32Array; im: Float32Array } {
	const size = input.length;
	const re = wRe ?? new Float32Array(size);
	const im = wIm ?? new Float32Array(size);

	re.set(input);

	if (wIm) im.fill(0);

	if (size <= 1) return { re, im };

	bitReverse(re, im, size);
	butterflyStages(re, im, size);

	return { re, im };
}

function fftInverse(re: Float32Array, im: Float32Array, wOutRe?: Float32Array, wOutIm?: Float32Array): Float32Array {
	const size = re.length;
	const outRe = wOutRe ?? Float32Array.from(re);
	const outIm = wOutIm ?? new Float32Array(size);

	if (wOutRe) outRe.set(re);

	for (let index = 0; index < size; index++) {
		outIm[index] = -(im[index] ?? 0);
	}

	bitReverse(outRe, outIm, size);
	butterflyStages(outRe, outIm, size);

	return outRe;
}

function bitReverse(re: Float32Array, im: Float32Array, size: number): void {
	let rev = 0;

	for (let index = 0; index < size - 1; index++) {
		if (index < rev) {
			const tempRe = re[index] ?? 0;
			const tempIm = im[index] ?? 0;
			re[index] = re[rev] ?? 0;
			im[index] = im[rev] ?? 0;
			re[rev] = tempRe;
			im[rev] = tempIm;
		}

		let bit = size >> 1;

		while (bit <= rev) {
			rev -= bit;
			bit >>= 1;
		}

		rev += bit;
	}
}

function butterflyStages(re: Float32Array, im: Float32Array, size: number): void {
	for (let step = 2; step <= size; step *= 2) {
		const halfStep = step / 2;
		const angle = (-2 * Math.PI) / step;

		for (let group = 0; group < size; group += step) {
			for (let pair = 0; pair < halfStep; pair++) {
				const twiddleRe = Math.cos(angle * pair);
				const twiddleIm = Math.sin(angle * pair);
				const evenIdx = group + pair;
				const oddIdx = group + pair + halfStep;

				const tRe = (re[oddIdx] ?? 0) * twiddleRe - (im[oddIdx] ?? 0) * twiddleIm;
				const tIm = (re[oddIdx] ?? 0) * twiddleIm + (im[oddIdx] ?? 0) * twiddleRe;

				re[oddIdx] = (re[evenIdx] ?? 0) - tRe;
				im[oddIdx] = (im[evenIdx] ?? 0) - tIm;
				re[evenIdx] = (re[evenIdx] ?? 0) + tRe;
				im[evenIdx] = (im[evenIdx] ?? 0) + tIm;
			}
		}
	}
}

export function dialogueIsolate(
	modelPath: string,
	options?: {
		dialogueGain?: number;
		noiseGain?: number;
		highPass?: number;
		lowPass?: number;
		id?: string;
	},
): MusicRebalanceModule {
	const dialogueLinear = dbToLinear(options?.dialogueGain ?? 0);
	const noiseLinear = dbToLinear(options?.noiseGain ?? -Infinity);

	return new MusicRebalanceModule({
		modelPath,
		stems: {
			vocals: dialogueLinear,
			drums: noiseLinear,
			bass: noiseLinear,
			other: noiseLinear,
		},
		highPass: options?.highPass ?? 80,
		lowPass: options?.lowPass ?? 20000,
		id: options?.id,
	});
}

function applyBiquadFilter(signal: Float32Array, sampleRate: number, frequency: number, type: "lowpass" | "highpass"): void {
	const w0 = (2 * Math.PI * frequency) / sampleRate;
	const cosW0 = Math.cos(w0);
	const sinW0 = Math.sin(w0);
	const alpha = sinW0 / Math.SQRT2; // Butterworth Q

	let b0: number, b1: number, b2: number;

	if (type === "lowpass") {
		b0 = (1 - cosW0) / 2;
		b1 = 1 - cosW0;
		b2 = (1 - cosW0) / 2;
	} else {
		b0 = (1 + cosW0) / 2;
		b1 = -(1 + cosW0);
		b2 = (1 + cosW0) / 2;
	}

	const a0 = 1 + alpha;
	const a1 = -2 * cosW0;
	const a2 = 1 - alpha;

	const nb0 = b0 / a0;
	const nb1 = b1 / a0;
	const nb2 = b2 / a0;
	const na1 = a1 / a0;
	const na2 = a2 / a0;

	// Zero-phase: forward then backward pass
	let x1 = 0,
		x2 = 0,
		y1 = 0,
		y2 = 0;

	for (let index = 0; index < signal.length; index++) {
		const x0 = signal[index] ?? 0;
		const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
		signal[index] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}

	x1 = 0;
	x2 = 0;
	y1 = 0;
	y2 = 0;

	for (let index = signal.length - 1; index >= 0; index--) {
		const x0 = signal[index] ?? 0;
		const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
		signal[index] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}
}
