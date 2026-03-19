/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { FftBackend } from "./fft-backend";
import { getFftAddon } from "./fft-backend";

export interface StftResult {
	readonly real: Array<Float32Array>;
	readonly imag: Array<Float32Array>;
	readonly frames: number;
	readonly fftSize: number;
}

export interface StftOutput {
	readonly real: Array<Float32Array>;
	readonly imag: Array<Float32Array>;
}

export function stft(signal: Float32Array, fftSize: number, hopSize: number, output?: StftOutput, backend?: FftBackend, fftAddonOptions?: { vkfftPath?: string; fftwPath?: string }): StftResult {
	const window = hanningWindow(fftSize);
	const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
	const halfSize = fftSize / 2 + 1;

	const addon = backend ? getFftAddon(backend, fftAddonOptions) : null;

	if (addon && numFrames > 0) {
		// Native path: window all frames, batch FFT in a single call
		const batchInput = new Float32Array(fftSize * numFrames);
		for (let frame = 0; frame < numFrames; frame++) {
			const offset = frame * hopSize;
			for (let index = 0; index < fftSize; index++) {
				batchInput[frame * fftSize + index] = (signal[offset + index] ?? 0) * (window[index] ?? 0);
			}
		}

		const { re: batchRe, im: batchIm } = addon.batchFft(batchInput, fftSize, numFrames);

		const real = output?.real ?? [];
		const imag = output?.imag ?? [];
		for (let frame = 0; frame < numFrames; frame++) {
			const reSlice = batchRe.subarray(frame * halfSize, (frame + 1) * halfSize);
			const imSlice = batchIm.subarray(frame * halfSize, (frame + 1) * halfSize);
			if (output) {
				output.real[frame]?.set(reSlice);
				output.imag[frame]?.set(imSlice);
			} else {
				real.push(Float32Array.from(reSlice));
				imag.push(Float32Array.from(imSlice));
			}
		}
		return { real, imag, frames: numFrames, fftSize };
	}

	// JS fallback path
	const real = output?.real ?? [];
	const imag = output?.imag ?? [];
	const windowed = new Float32Array(fftSize);
	const workspace = createFftWorkspace(fftSize);

	for (let frame = 0; frame < numFrames; frame++) {
		const offset = frame * hopSize;

		for (let index = 0; index < fftSize; index++) {
			windowed[index] = (signal[offset + index] ?? 0) * (window[index] ?? 0);
		}

		const { re, im } = fft(windowed, workspace);

		if (output) {
			output.real[frame]?.set(re.subarray(0, halfSize));
			output.imag[frame]?.set(im.subarray(0, halfSize));
		} else {
			real.push(re.slice(0, halfSize));
			imag.push(im.slice(0, halfSize));
		}
	}

	return { real, imag, frames: numFrames, fftSize };
}

export function istft(result: StftResult, hopSize: number, outputLength: number, backend?: FftBackend, fftAddonOptions?: { vkfftPath?: string; fftwPath?: string }): Float32Array {
	const { real, imag, frames, fftSize } = result;
	const window = hanningWindow(fftSize);
	const output = new Float32Array(outputLength);
	const windowSum = new Float32Array(outputLength);
	const halfSize = fftSize / 2 + 1;

	const addon = backend ? getFftAddon(backend, fftAddonOptions) : null;

	if (addon && frames > 0) {
		// Native path: batch all iFFTs in a single call
		const batchRe = new Float32Array(halfSize * frames);
		const batchIm = new Float32Array(halfSize * frames);

		for (let frame = 0; frame < frames; frame++) {
			const re = real[frame];
			const im = imag[frame];
			if (!re || !im) continue;
			batchRe.set(re, frame * halfSize);
			batchIm.set(im, frame * halfSize);
		}

		const timeDomainBatch = addon.batchIfft(batchRe, batchIm, fftSize, frames);

		for (let frame = 0; frame < frames; frame++) {
			const offset = frame * hopSize;
			for (let index = 0; index < fftSize; index++) {
				const pos = offset + index;
				if (pos < outputLength) {
					output[pos] = (output[pos] ?? 0) + (timeDomainBatch[frame * fftSize + index] ?? 0) * (window[index] ?? 0);
					windowSum[pos] = (windowSum[pos] ?? 0) + (window[index] ?? 0) * (window[index] ?? 0);
				}
			}
		}
	} else {
		// JS fallback path
		const fullRe = new Float32Array(fftSize);
		const fullIm = new Float32Array(fftSize);
		const workspace = createFftWorkspace(fftSize);

		for (let frame = 0; frame < frames; frame++) {
			const re = real[frame];
			const im = imag[frame];

			if (!re || !im) continue;

			fullRe.fill(0);
			fullIm.fill(0);
			fullRe.set(re);
			fullIm.set(im);

			for (let index = 1; index < halfSize - 1; index++) {
				fullRe[fftSize - index] = re[index] ?? 0;
				fullIm[fftSize - index] = -(im[index] ?? 0);
			}

			const timeDomain = ifft(fullRe, fullIm, workspace);
			const offset = frame * hopSize;

			for (let index = 0; index < fftSize; index++) {
				const pos = offset + index;

				if (pos < outputLength) {
					output[pos] = (output[pos] ?? 0) + (timeDomain[index] ?? 0) * (window[index] ?? 0);
					windowSum[pos] = (windowSum[pos] ?? 0) + (window[index] ?? 0) * (window[index] ?? 0);
				}
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

const hanningWindowCache = new Map<string, Float32Array>();

export function hanningWindow(size: number, periodic = true): Float32Array {
	const key = `${size}:${periodic ? "p" : "s"}`;
	const cached = hanningWindowCache.get(key);

	if (cached) return cached;

	const window = new Float32Array(size);
	const denominator = periodic ? size : size - 1;

	for (let index = 0; index < size; index++) {
		window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / denominator));
	}

	hanningWindowCache.set(key, window);

	return window;
}

export interface FftWorkspace {
	re: Float32Array;
	im: Float32Array;
	outRe: Float32Array;
	outIm: Float32Array;
}

export function createFftWorkspace(size: number): FftWorkspace {
	return {
		re: new Float32Array(size),
		im: new Float32Array(size),
		outRe: new Float32Array(size),
		outIm: new Float32Array(size),
	};
}

export function fft(input: Float32Array, workspace?: FftWorkspace): { re: Float32Array; im: Float32Array } {
	const size = input.length;
	const re = workspace ? workspace.re : new Float32Array(size);
	const im = workspace ? workspace.im : new Float32Array(size);

	re.set(input);

	if (workspace) im.fill(0);

	if (size <= 1) return { re, im };

	bitReverse(re, im, size);
	butterflyStages(re, im, size);

	return { re, im };
}

export function ifft(re: Float32Array, im: Float32Array, workspace?: FftWorkspace): Float32Array {
	const size = re.length;
	const outRe = workspace ? workspace.outRe : Float32Array.from(re);
	const outIm = workspace ? workspace.outIm : new Float32Array(size);

	if (workspace) outRe.set(re);

	for (let index = 0; index < size; index++) {
		outIm[index] = -(im[index] ?? 0);
	}

	bitReverse(outRe, outIm, size);
	butterflyStages(outRe, outIm, size);

	for (let index = 0; index < size; index++) {
		outRe[index] = (outRe[index] ?? 0) / size;
	}

	return outRe;
}

export function bitReverse(re: Float32Array, im: Float32Array, size: number): void {
	let rev = 0;

	for (let index = 0; index < size - 1; index++) {
		if (index < rev) {
			const tempRe = re[index]!;
			const tempIm = im[index]!;
			re[index] = re[rev]!;
			im[index] = im[rev]!;
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

const twiddleCache = new Map<number, { re: Float32Array; im: Float32Array }>();

function getTwiddleFactors(size: number): { re: Float32Array; im: Float32Array } {
	let cached = twiddleCache.get(size);

	if (cached) return cached;

	// Total twiddle factors needed: sum of halfStep for each stage = size/2 * log2(size)
	// Layout: for step=2,4,8,...,size, store halfStep entries contiguously
	const totalFactors = (size / 2) * Math.log2(size);
	const twRe = new Float32Array(totalFactors);
	const twIm = new Float32Array(totalFactors);
	let offset = 0;

	for (let step = 2; step <= size; step *= 2) {
		const halfStep = step / 2;
		const angle = (-2 * Math.PI) / step;

		for (let pair = 0; pair < halfStep; pair++) {
			twRe[offset + pair] = Math.cos(angle * pair);
			twIm[offset + pair] = Math.sin(angle * pair);
		}

		offset += halfStep;
	}

	cached = { re: twRe, im: twIm };
	twiddleCache.set(size, cached);

	return cached;
}

export function butterflyStages(re: Float32Array, im: Float32Array, size: number): void {
	const twiddle = getTwiddleFactors(size);
	const twRe = twiddle.re;
	const twIm = twiddle.im;
	let twOffset = 0;

	for (let step = 2; step <= size; step *= 2) {
		const halfStep = step / 2;

		for (let group = 0; group < size; group += step) {
			for (let pair = 0; pair < halfStep; pair++) {
				const wr = twRe[twOffset + pair]!;
				const wi = twIm[twOffset + pair]!;
				const evenIdx = group + pair;
				const oddIdx = group + pair + halfStep;

				const oddRe = re[oddIdx]!;
				const oddIm = im[oddIdx]!;
				const evenRe = re[evenIdx]!;
				const evenIm = im[evenIdx]!;

				const tRe = oddRe * wr - oddIm * wi;
				const tIm = oddRe * wi + oddIm * wr;

				re[oddIdx] = evenRe - tRe;
				im[oddIdx] = evenIm - tIm;
				re[evenIdx] = evenRe + tRe;
				im[evenIdx] = evenIm + tIm;
			}
		}

		twOffset += halfStep;
	}
}
