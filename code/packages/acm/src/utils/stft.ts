export interface StftResult {
	readonly real: Array<Float32Array>;
	readonly imag: Array<Float32Array>;
	readonly frames: number;
	readonly fftSize: number;
}

export function stft(signal: Float32Array, fftSize: number, hopSize: number): StftResult {
	const window = hanningWindow(fftSize);
	const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
	const halfSize = fftSize / 2 + 1;

	const real: Array<Float32Array> = [];
	const imag: Array<Float32Array> = [];
	const windowed = new Float32Array(fftSize);
	const workspace = createFftWorkspace(fftSize);

	for (let frame = 0; frame < numFrames; frame++) {
		const offset = frame * hopSize;

		for (let index = 0; index < fftSize; index++) {
			windowed[index] = (signal[offset + index] ?? 0) * (window[index] ?? 0);
		}

		const { re, im } = fft(windowed, workspace);

		real.push(re.slice(0, halfSize));
		imag.push(im.slice(0, halfSize));
	}

	return { real, imag, frames: numFrames, fftSize };
}

export function istft(result: StftResult, hopSize: number, outputLength: number): Float32Array {
	const { real, imag, frames, fftSize } = result;
	const window = hanningWindow(fftSize);
	const output = new Float32Array(outputLength);
	const windowSum = new Float32Array(outputLength);

	const fullRe = new Float32Array(fftSize);
	const fullIm = new Float32Array(fftSize);
	const halfSize = fftSize / 2 + 1;
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

	for (let index = 0; index < outputLength; index++) {
		const ws = windowSum[index] ?? 0;

		if (ws > 1e-8) {
			output[index] = (output[index] ?? 0) / ws;
		}
	}

	return output;
}

const hanningWindowCache = new Map<number, Float32Array>();

function hanningWindow(size: number): Float32Array {
	const cached = hanningWindowCache.get(size);

	if (cached) return cached;

	const window = new Float32Array(size);

	for (let index = 0; index < size; index++) {
		window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
	}

	hanningWindowCache.set(size, window);

	return window;
}

interface FftWorkspace {
	re: Float32Array;
	im: Float32Array;
	outRe: Float32Array;
	outIm: Float32Array;
}

function createFftWorkspace(size: number): FftWorkspace {
	return {
		re: new Float32Array(size),
		im: new Float32Array(size),
		outRe: new Float32Array(size),
		outIm: new Float32Array(size),
	};
}

function fft(input: Float32Array, workspace?: FftWorkspace): { re: Float32Array; im: Float32Array } {
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

function ifft(re: Float32Array, im: Float32Array, workspace?: FftWorkspace): Float32Array {
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
