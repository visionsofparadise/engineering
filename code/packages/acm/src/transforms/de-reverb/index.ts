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
});

export interface DeReverbProperties extends z.infer<typeof schema>, TransformModuleProperties {}

/**
 * Reduces late reverberation from speech using the Weighted Prediction Error (WPE) algorithm.
 *
 * @see Nakatani, T., Yoshioka, T., Kinoshita, K., Miyoshi, M., Juang, B.H. (2010).
 *   "Speech Dereverberation Based on Variance-Normalized Delayed Linear Prediction."
 *   IEEE TASLP, 18(7), 1717-1731. https://doi.org/10.1109/TASL.2010.2052251
 */
export class DeReverbModule extends TransformModule<DeReverbProperties> {
	static override readonly moduleName = "De-Reverb";
	static override readonly moduleDescription = "Reduce room reverb and echo";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeReverbModule {
		return TransformModule.is(value) && value.type[2] === "de-reverb";
	}

	override readonly type = ["async-module", "transform", "de-reverb"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private fftBackend: FftBackend = "js";

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.fftBackend = detectFftBackend(context.executionProviders);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames, channels } = buffer;

		const fftSize = 1024;
		const hopSize = fftSize / 4;
		const halfSize = fftSize / 2 + 1;
		const numStftFrames = Math.floor((frames - fftSize) / hopSize) + 1;
		const stftOutput = numStftFrames > 0 ? {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
		} : undefined;

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			const stftResult = stft(channel, fftSize, hopSize, stftOutput, this.fftBackend);
			const numFrames = stftResult.frames;
			const numBins = stftResult.real[0]?.length ?? 0;

			const { predictionDelay, filterLength, iterations } = this.properties;

			// Pre-allocate power arrays for reuse across iterations
			const originalPowerArrays: Array<Float32Array> = [];
			const iterationPowerArrays: Array<Float32Array> = [];

			for (let frame = 0; frame < numFrames; frame++) {
				originalPowerArrays.push(new Float32Array(numBins));
				iterationPowerArrays.push(new Float32Array(numBins));
			}

			// Save original power as upper bound — dereverberation should only reduce power
			const originalPower = estimatePower(stftResult.real, stftResult.imag, numFrames, numBins, originalPowerArrays);

			const filterCoeffsReal = new Float32Array(filterLength);
			const filterCoeffsImag = new Float32Array(filterLength);
			const corrRealReal = new Float32Array(filterLength * filterLength);
			const corrRealImag = new Float32Array(filterLength * filterLength);
			const crossReal = new Float32Array(filterLength);
			const crossImag = new Float32Array(filterLength);
			const arWork = new Float32Array(filterLength * filterLength);
			const aiWork = new Float32Array(filterLength * filterLength);
			const brWork = new Float32Array(filterLength);
			const biWork = new Float32Array(filterLength);

			for (let iter = 0; iter < iterations; iter++) {
				const power = iter === 0 ? originalPower : estimatePower(stftResult.real, stftResult.imag, numFrames, numBins, iterationPowerArrays);

				for (let bin = 0; bin < numBins; bin++) {
					filterCoeffsReal.fill(0);
					filterCoeffsImag.fill(0);

					solveWpeFilter(stftResult.real, stftResult.imag, power, bin, numFrames, predictionDelay, filterLength, filterCoeffsReal, filterCoeffsImag, corrRealReal, corrRealImag, crossReal, crossImag, arWork, aiWork, brWork, biWork);

					for (let frame = predictionDelay + filterLength; frame < numFrames; frame++) {
						let predReal = 0;
						let predImag = 0;

						for (let tap = 0; tap < filterLength; tap++) {
							const pastFrame = frame - predictionDelay - tap - 1;
							const pastReal = stftResult.real[pastFrame]?.[bin] ?? 0;
							const pastImag = stftResult.imag[pastFrame]?.[bin] ?? 0;

							predReal += (filterCoeffsReal[tap] ?? 0) * pastReal - (filterCoeffsImag[tap] ?? 0) * pastImag;
							predImag += (filterCoeffsReal[tap] ?? 0) * pastImag + (filterCoeffsImag[tap] ?? 0) * pastReal;
						}

						const realFrame = stftResult.real[frame];
						const imagFrame = stftResult.imag[frame];

						if (realFrame && imagFrame) {
							const newReal = (realFrame[bin] ?? 0) - predReal;
							const newImag = (imagFrame[bin] ?? 0) - predImag;

							// Clamp: output power must not exceed original power
							const newPower = newReal * newReal + newImag * newImag;
							const origPow = originalPower[frame]?.[bin] ?? 1e-10;

							if (newPower > origPow) {
								const scale = Math.sqrt(origPow / newPower);
								realFrame[bin] = newReal * scale;
								imagFrame[bin] = newImag * scale;
							} else {
								realFrame[bin] = newReal;
								imagFrame[bin] = newImag;
							}
						}
					}
				}
			}

			const dereverberated = istft(stftResult, hopSize, frames, this.fftBackend);
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

function estimatePower(real: Array<Float32Array>, imag: Array<Float32Array>, numFrames: number, numBins: number, output: Array<Float32Array>): Array<Float32Array> {
	for (let frame = 0; frame < numFrames; frame++) {
		const framePower = output[frame];

		if (!framePower) continue;
		const re = real[frame];
		const im = imag[frame];

		if (re && im) {
			for (let bin = 0; bin < numBins; bin++) {
				const rVal = re[bin] ?? 0;
				const iVal = im[bin] ?? 0;
				framePower[bin] = Math.max(rVal * rVal + iVal * iVal, 1e-10);
			}
		} else {
			framePower.fill(1e-10);
		}
	}

	return output;
}

function solveWpeFilter(
	real: Array<Float32Array>,
	imag: Array<Float32Array>,
	power: Array<Float32Array>,
	bin: number,
	numFrames: number,
	predictionDelay: number,
	filterLength: number,
	outReal: Float32Array,
	outImag: Float32Array,
	corrRealReal: Float32Array,
	corrRealImag: Float32Array,
	crossReal: Float32Array,
	crossImag: Float32Array,
	arWork: Float32Array,
	aiWork: Float32Array,
	brWork: Float32Array,
	biWork: Float32Array,
): void {
	corrRealReal.fill(0);
	corrRealImag.fill(0);
	crossReal.fill(0);
	crossImag.fill(0);

	for (let frame = predictionDelay + filterLength; frame < numFrames; frame++) {
		const weight = 1 / (power[frame]?.[bin] ?? 1);

		const targetReal = real[frame]?.[bin] ?? 0;
		const targetImag = imag[frame]?.[bin] ?? 0;

		for (let tap1 = 0; tap1 < filterLength; tap1++) {
			const pastFrame1 = frame - predictionDelay - tap1 - 1;
			const pastReal1 = real[pastFrame1]?.[bin] ?? 0;
			const pastImag1 = imag[pastFrame1]?.[bin] ?? 0;

			crossReal[tap1] = (crossReal[tap1] ?? 0) + weight * (pastReal1 * targetReal + pastImag1 * targetImag);
			crossImag[tap1] = (crossImag[tap1] ?? 0) + weight * (pastReal1 * targetImag - pastImag1 * targetReal);

			for (let tap2 = 0; tap2 < filterLength; tap2++) {
				const pastFrame2 = frame - predictionDelay - tap2 - 1;
				const pastReal2 = real[pastFrame2]?.[bin] ?? 0;
				const pastImag2 = imag[pastFrame2]?.[bin] ?? 0;

				corrRealReal[tap1 * filterLength + tap2] = (corrRealReal[tap1 * filterLength + tap2] ?? 0) + weight * (pastReal1 * pastReal2 + pastImag1 * pastImag2);
				corrRealImag[tap1 * filterLength + tap2] = (corrRealImag[tap1 * filterLength + tap2] ?? 0) + weight * (pastReal1 * pastImag2 - pastImag1 * pastReal2);
			}
		}
	}

	for (let tap = 0; tap < filterLength; tap++) {
		corrRealReal[tap * filterLength + tap] = (corrRealReal[tap * filterLength + tap] ?? 0) + 1e-6;
	}

	solveLinearSystem(corrRealReal, corrRealImag, crossReal, crossImag, filterLength, outReal, outImag, arWork, aiWork, brWork, biWork);
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

export function deReverb(options?: { sensitivity?: number; predictionDelay?: number; filterLength?: number; iterations?: number; id?: string }): DeReverbModule {
	const sensitivity = Math.max(0, Math.min(1, options?.sensitivity ?? 0.5));

	return new DeReverbModule({
		predictionDelay: options?.predictionDelay ?? Math.round(2 + (1 - sensitivity) * 4),
		filterLength: options?.filterLength ?? Math.round(5 + sensitivity * 15),
		iterations: options?.iterations ?? Math.round(2 + sensitivity * 4),
		id: options?.id,
	});
}
