import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { detectFftBackend, type FftBackend } from "../../utils/fft-backend";
import { istft, stft } from "../../utils/stft";

export const schema = z.object({
	predictionDelay: z.number().min(1).max(10).multipleOf(1).default(4).describe("Prediction Delay"),
	filterLength: z.number().min(5).max(30).multipleOf(1).default(12).describe("Filter Length"),
	iterations: z.number().min(1).max(10).multipleOf(1).default(4).describe("Iterations"),
	vkfftAddonPath: z.string().default("").meta({ input: "file", mode: "open", binary: "vkfft-addon", download: "https://github.com/visionsofparadise/vkfft-addon" }).describe("VkFFT native addon — GPU FFT acceleration"),
	fftwAddonPath: z.string().default("").meta({ input: "file", mode: "open", binary: "fftw-addon", download: "https://github.com/visionsofparadise/fftw-addon" }).describe("FFTW native addon — CPU FFT acceleration"),
});

export interface DeReverbProperties extends z.infer<typeof schema>, TransformModuleProperties {}

/**
 * Reduces late reverberation from speech using the Weighted Prediction Error (WPE) algorithm.
 * WPE models reverb as a linear prediction problem in the STFT domain — for each frequency bin,
 * it estimates how past frames predict the current frame's reverberant tail, then subtracts that
 * prediction. This is a classical signal processing approach: fully deterministic, tunable via
 * prediction delay and filter length, and requires no pretrained model. The tradeoff is compute
 * cost — WPE solves a linear system per frequency bin per iteration, which scales linearly with
 * audio length but with a large constant factor. Best suited for offline processing or when
 * precise parameter control is needed. For faster real-time dereverberation, consider a
 * neural-network-based alternative.
 *
 * @see Nakatani, T., Yoshioka, T., Kinoshita, K., Miyoshi, M., Juang, B.H. (2010).
 *   "Speech Dereverberation Based on Variance-Normalized Delayed Linear Prediction."
 *   IEEE TASLP, 18(7), 1717-1731. https://doi.org/10.1109/TASL.2010.2052251
 */
export class DeReverbModule extends TransformModule<DeReverbProperties> {
	static override readonly moduleName = "De-Reverb (WPE)";
	static override readonly moduleDescription = "Reduce room reverb using Weighted Prediction Error — classical DSP, fully tunable, no model required";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeReverbModule {
		return TransformModule.is(value) && value.type[2] === "de-reverb";
	}

	override readonly type = ["async-module", "transform", "de-reverb"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private fftBackend: FftBackend = "js";
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.fftAddonOptions = { vkfftPath: this.properties.vkfftAddonPath || undefined, fftwPath: this.properties.fftwAddonPath || undefined };
		this.fftBackend = detectFftBackend(context.executionProviders, this.fftAddonOptions);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames, channels } = buffer;

		const fftSize = 1024;
		const hopSize = fftSize / 4;
		const numBins = fftSize / 2 + 1;
		const numStftFrames = Math.floor((frames - fftSize) / hopSize) + 1;
		const stftOutput = numStftFrames > 0 ? {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
		} : undefined;

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			const stftResult = stft(channel, fftSize, hopSize, stftOutput, this.fftBackend, this.fftAddonOptions);
			const numFrames = stftResult.frames;

			if (numFrames === 0) continue;

			const { predictionDelay, filterLength, iterations } = this.properties;

			// Transpose to bin-major layout: flat array indexed as [bin * numFrames + frame]
			// This makes the per-bin frame iteration sequential in memory
			const realT = new Float32Array(numBins * numFrames);
			const imagT = new Float32Array(numBins * numFrames);

			for (let frame = 0; frame < numFrames; frame++) {
				const re = stftResult.real[frame]!;
				const im = stftResult.imag[frame]!;

				for (let bin = 0; bin < numBins; bin++) {
					realT[bin * numFrames + frame] = re[bin]!;
					imagT[bin * numFrames + frame] = im[bin]!;
				}
			}

			// Original power per bin (bin-major), used as upper bound for clamping
			const originalPowerT = new Float32Array(numBins * numFrames);

			for (let i = 0; i < realT.length; i++) {
				originalPowerT[i] = Math.max(realT[i]! * realT[i]! + imagT[i]! * imagT[i]!, 1e-10);
			}

			// Compute per-bin energy to skip silent bins
			const binEnergy = new Float32Array(numBins);

			for (let bin = 0; bin < numBins; bin++) {
				const offset = bin * numFrames;
				let energy = 0;

				for (let frame = 0; frame < numFrames; frame++) {
					energy += originalPowerT[offset + frame]!;
				}

				binEnergy[bin] = energy;
			}

			const meanEnergy = binEnergy.reduce((a, b) => a + b, 0) / numBins;
			const energyThreshold = meanEnergy * 1e-4;

			// Pre-allocate work arrays
			const L = filterLength;
			const corrReal = new Float32Array(L * L);
			const corrImag = new Float32Array(L * L);
			const crossReal = new Float32Array(L);
			const crossImag = new Float32Array(L);
			const filterReal = new Float32Array(L);
			const filterImag = new Float32Array(L);
			const arWork = new Float32Array(L * L);
			const aiWork = new Float32Array(L * L);
			const brWork = new Float32Array(L);
			const biWork = new Float32Array(L);

			// Iteration power buffer (recomputed each iteration from modified STFT)
			const iterPowerT = new Float32Array(numBins * numFrames);

			for (let iter = 0; iter < iterations; iter++) {
				let powerT: Float32Array;

				if (iter === 0) {
					powerT = originalPowerT;
				} else {
					for (let i = 0; i < realT.length; i++) {
						iterPowerT[i] = Math.max(realT[i]! * realT[i]! + imagT[i]! * imagT[i]!, 1e-10);
					}

					powerT = iterPowerT;
				}

				for (let bin = 0; bin < numBins; bin++) {
					if (binEnergy[bin]! < energyThreshold) continue;

					const bo = bin * numFrames; // bin offset into flat arrays

					filterReal.fill(0);
					filterImag.fill(0);

					solveWpeFilter(realT, imagT, powerT, bo, numFrames, predictionDelay, L, filterReal, filterImag, corrReal, corrImag, crossReal, crossImag, arWork, aiWork, brWork, biWork);

					// Apply prediction filter and subtract reverb estimate
					for (let frame = predictionDelay + L; frame < numFrames; frame++) {
						let predR = 0;
						let predI = 0;

						for (let tap = 0; tap < L; tap++) {
							const pastIdx = bo + frame - predictionDelay - tap - 1;
							const pR = realT[pastIdx]!;
							const pI = imagT[pastIdx]!;

							predR += filterReal[tap]! * pR - filterImag[tap]! * pI;
							predI += filterReal[tap]! * pI + filterImag[tap]! * pR;
						}

						const idx = bo + frame;
						const newR = realT[idx]! - predR;
						const newI = imagT[idx]! - predI;

						// Clamp: output power must not exceed original power
						const newPow = newR * newR + newI * newI;
						const origPow = originalPowerT[idx]!;

						if (newPow > origPow) {
							const scale = Math.sqrt(origPow / newPow);
							realT[idx] = newR * scale;
							imagT[idx] = newI * scale;
						} else {
							realT[idx] = newR;
							imagT[idx] = newI;
						}
					}
				}
			}

			// Transpose back to frame-major for iSTFT
			for (let frame = 0; frame < numFrames; frame++) {
				const re = stftResult.real[frame]!;
				const im = stftResult.imag[frame]!;

				for (let bin = 0; bin < numBins; bin++) {
					re[bin] = realT[bin * numFrames + frame]!;
					im[bin] = imagT[bin * numFrames + frame]!;
				}
			}

			const dereverberated = istft(stftResult, hopSize, frames, this.fftBackend, this.fftAddonOptions);
			const allChannels: Array<Float32Array> = [];

			for (let writeCh = 0; writeCh < channels; writeCh++) {
				allChannels.push(writeCh === ch ? dereverberated : (chunk.samples[writeCh] ?? new Float32Array(frames)));
			}

			await buffer.write(0, allChannels);
		}
	}

	clone(overrides?: Partial<DeReverbProperties>): DeReverbModule {
		return new DeReverbModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

/**
 * Solve WPE filter for a single bin using transposed (bin-major) flat arrays.
 * binOffset is the starting index into the flat arrays for this bin.
 * Exploits Hermitian symmetry of the correlation matrix — only computes
 * the upper triangle (tap2 >= tap1), then mirrors to the lower half.
 */
function solveWpeFilter(
	realT: Float32Array,
	imagT: Float32Array,
	powerT: Float32Array,
	binOffset: number,
	numFrames: number,
	predictionDelay: number,
	filterLength: number,
	outReal: Float32Array,
	outImag: Float32Array,
	corrReal: Float32Array,
	corrImag: Float32Array,
	crossReal: Float32Array,
	crossImag: Float32Array,
	arWork: Float32Array,
	aiWork: Float32Array,
	brWork: Float32Array,
	biWork: Float32Array,
): void {
	corrReal.fill(0);
	corrImag.fill(0);
	crossReal.fill(0);
	crossImag.fill(0);

	const L = filterLength;
	const D = predictionDelay;

	for (let frame = D + L; frame < numFrames; frame++) {
		const weight = 1 / powerT[binOffset + frame]!;
		const targetR = realT[binOffset + frame]!;
		const targetI = imagT[binOffset + frame]!;

		for (let tap1 = 0; tap1 < L; tap1++) {
			const pastIdx1 = binOffset + frame - D - tap1 - 1;
			const pR1 = realT[pastIdx1]!;
			const pI1 = imagT[pastIdx1]!;

			crossReal[tap1] = (crossReal[tap1] ?? 0) + weight * (pR1 * targetR + pI1 * targetI);
			crossImag[tap1] = (crossImag[tap1] ?? 0) + weight * (pR1 * targetI - pI1 * targetR);

			// Upper triangle only (Hermitian: corr[i][j] = conj(corr[j][i]))
			for (let tap2 = tap1; tap2 < L; tap2++) {
				const pastIdx2 = binOffset + frame - D - tap2 - 1;
				const pR2 = realT[pastIdx2]!;
				const pI2 = imagT[pastIdx2]!;

				corrReal[tap1 * L + tap2] = (corrReal[tap1 * L + tap2] ?? 0) + weight * (pR1 * pR2 + pI1 * pI2);
				corrImag[tap1 * L + tap2] = (corrImag[tap1 * L + tap2] ?? 0) + weight * (pR1 * pI2 - pI1 * pR2);
			}
		}
	}

	// Fill lower triangle from conjugate of upper
	for (let tap1 = 1; tap1 < L; tap1++) {
		for (let tap2 = 0; tap2 < tap1; tap2++) {
			corrReal[tap1 * L + tap2] = corrReal[tap2 * L + tap1]!;
			corrImag[tap1 * L + tap2] = -corrImag[tap2 * L + tap1]!;
		}
	}

	// Regularize diagonal
	for (let tap = 0; tap < L; tap++) {
		corrReal[tap * L + tap] = (corrReal[tap * L + tap] ?? 0) + 1e-6;
	}

	solveLinearSystem(corrReal, corrImag, crossReal, crossImag, L, outReal, outImag, arWork, aiWork, brWork, biWork);
}

function solveLinearSystem(aReal: Float32Array, aImag: Float32Array, bReal: Float32Array, bImag: Float32Array, size: number, outReal: Float32Array, outImag: Float32Array, ar: Float32Array, ai: Float32Array, br: Float32Array, bi: Float32Array): void {
	ar.set(aReal);
	ai.set(aImag);
	br.set(bReal);
	bi.set(bImag);

	for (let col = 0; col < size; col++) {
		// Partial pivoting: find row with largest magnitude in this column
		let maxMag = 0;
		let maxRow = col;

		for (let row = col; row < size; row++) {
			const re = ar[row * size + col] ?? 0;
			const im = ai[row * size + col] ?? 0;
			const mag = re * re + im * im;

			if (mag > maxMag) {
				maxMag = mag;
				maxRow = row;
			}
		}

		if (maxMag < 1e-20) continue;

		// Swap rows
		if (maxRow !== col) {
			for (let sc = col; sc < size; sc++) {
				const tmpR = ar[col * size + sc] ?? 0;
				const tmpI = ai[col * size + sc] ?? 0;
				ar[col * size + sc] = ar[maxRow * size + sc] ?? 0;
				ai[col * size + sc] = ai[maxRow * size + sc] ?? 0;
				ar[maxRow * size + sc] = tmpR;
				ai[maxRow * size + sc] = tmpI;
			}

			const tmpBr = br[col] ?? 0;
			const tmpBi = bi[col] ?? 0;
			br[col] = br[maxRow] ?? 0;
			bi[col] = bi[maxRow] ?? 0;
			br[maxRow] = tmpBr;
			bi[maxRow] = tmpBi;
		}

		// Pivot element
		const pivR = ar[col * size + col] ?? 0;
		const pivI = ai[col * size + col] ?? 0;
		const pivMag2 = pivR * pivR + pivI * pivI;

		// Eliminate below pivot
		for (let row = col + 1; row < size; row++) {
			const elemR = ar[row * size + col] ?? 0;
			const elemI = ai[row * size + col] ?? 0;

			// factor = elem / pivot (complex division)
			const factR = (elemR * pivR + elemI * pivI) / pivMag2;
			const factI = (elemI * pivR - elemR * pivI) / pivMag2;

			for (let ec = col + 1; ec < size; ec++) {
				const ajR = ar[col * size + ec] ?? 0;
				const ajI = ai[col * size + ec] ?? 0;

				ar[row * size + ec] = (ar[row * size + ec] ?? 0) - (factR * ajR - factI * ajI);
				ai[row * size + ec] = (ai[row * size + ec] ?? 0) - (factR * ajI + factI * ajR);
			}

			br[row] = (br[row] ?? 0) - (factR * (br[col] ?? 0) - factI * (bi[col] ?? 0));
			bi[row] = (bi[row] ?? 0) - (factR * (bi[col] ?? 0) + factI * (br[col] ?? 0));

			ar[row * size + col] = 0;
			ai[row * size + col] = 0;
		}
	}

	// Back-substitution
	for (let row = size - 1; row >= 0; row--) {
		let sumR = br[row] ?? 0;
		let sumI = bi[row] ?? 0;

		for (let bc = row + 1; bc < size; bc++) {
			const ajR = ar[row * size + bc] ?? 0;
			const ajI = ai[row * size + bc] ?? 0;
			const xjR = outReal[bc] ?? 0;
			const xjI = outImag[bc] ?? 0;

			sumR -= ajR * xjR - ajI * xjI;
			sumI -= ajR * xjI + ajI * xjR;
		}

		const diagR = ar[row * size + row] ?? 0;
		const diagI = ai[row * size + row] ?? 0;
		const diagMag2 = diagR * diagR + diagI * diagI;

		if (diagMag2 > 1e-20) {
			outReal[row] = (sumR * diagR + sumI * diagI) / diagMag2;
			outImag[row] = (sumI * diagR - sumR * diagI) / diagMag2;
		}
	}
}

export function deReverb(options?: { sensitivity?: number; predictionDelay?: number; filterLength?: number; iterations?: number; vkfftAddonPath?: string; fftwAddonPath?: string; id?: string }): DeReverbModule {
	const sensitivity = Math.max(0, Math.min(1, options?.sensitivity ?? 0.5));

	return new DeReverbModule({
		predictionDelay: options?.predictionDelay ?? Math.round(2 + (1 - sensitivity) * 4),
		filterLength: options?.filterLength ?? Math.round(5 + sensitivity * 15),
		iterations: options?.iterations ?? Math.round(2 + sensitivity * 4),
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		id: options?.id,
	});
}
