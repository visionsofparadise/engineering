/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { StreamContext } from "../../node";
import { initFftBackend, type FftBackend } from "../../utils/fft-backend";
import { replaceChannel } from "../../utils/replace-channel";
import { istft, stft } from "../../utils/stft";
import { solveWpeFilter } from "./utils/wpe";

export const schema = z.object({
	predictionDelay: z.number().min(1).max(10).multipleOf(1).default(4).describe("Prediction Delay"),
	filterLength: z.number().min(5).max(30).multipleOf(1).default(12).describe("Filter Length"),
	iterations: z.number().min(1).max(10).multipleOf(1).default(4).describe("Iterations"),
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

export interface DeReverbProperties extends z.infer<typeof schema>, TransformNodeProperties {}

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
export class DeReverbStream extends BufferedTransformStream<DeReverbProperties> {
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	override _setup(context: StreamContext): void {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { frames, channels } = buffer;

		const fftSize = 1024;
		const hopSize = fftSize / 4;
		const numBins = fftSize / 2 + 1;
		const paddedLength = Math.max(frames, fftSize);
		const numStftFrames = Math.floor((paddedLength - fftSize) / hopSize) + 1;
		const stftOutput = {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(numBins)),
		};

		const chunk = await buffer.read(0, frames);

		// Pre-allocate arrays once, reuse across channels
		// numStftFrames is the max possible; actual numFrames from stft() may be <=
		const flatSize = numBins * numStftFrames;
		const realT = new Float32Array(flatSize);
		const imagT = new Float32Array(flatSize);
		const originalPowerT = new Float32Array(flatSize);
		const iterPowerT = new Float32Array(flatSize);
		const binEnergy = new Float32Array(numBins);

		const { predictionDelay, filterLength, iterations } = this.properties;
		const filterLen = filterLength;
		const corrReal = new Float32Array(filterLen * filterLen);
		const corrImag = new Float32Array(filterLen * filterLen);
		const crossReal = new Float32Array(filterLen);
		const crossImag = new Float32Array(filterLen);
		const filterReal = new Float32Array(filterLen);
		const filterImag = new Float32Array(filterLen);
		const arWork = new Float32Array(filterLen * filterLen);
		const aiWork = new Float32Array(filterLen * filterLen);
		const brWork = new Float32Array(filterLen);
		const biWork = new Float32Array(filterLen);

		for (let ch = 0; ch < channels; ch++) {
			let channel = chunk.samples[ch];

			if (!channel) continue;

			if (channel.length < fftSize) {
				const padded = new Float32Array(fftSize);

				padded.set(channel);
				channel = padded;
			}

			const stftResult = stft(channel, fftSize, hopSize, stftOutput, this.fftBackend, this.fftAddonOptions);
			const numFrames = stftResult.frames;

			// Transpose to bin-major layout: flat array indexed as [bin * numFrames + frame]
			// This makes the per-bin frame iteration sequential in memory
			for (let frame = 0; frame < numFrames; frame++) {
				const re = stftResult.real[frame];
				const im = stftResult.imag[frame];

				if (!re || !im) continue;

				for (let bin = 0; bin < numBins; bin++) {
					realT[bin * numFrames + frame] = re[bin]!;
					imagT[bin * numFrames + frame] = im[bin]!;
				}
			}

			// Original power per bin (bin-major), used as upper bound for clamping
			const usedSize = numBins * numFrames;

			for (let ci = 0; ci < usedSize; ci++) {
				originalPowerT[ci] = Math.max(realT[ci]! * realT[ci]! + imagT[ci]! * imagT[ci]!, 1e-10);
			}

			// Compute per-bin energy to skip silent bins
			for (let bin = 0; bin < numBins; bin++) {
				const offset = bin * numFrames;
				let energy = 0;

				for (let frame = 0; frame < numFrames; frame++) {
					energy += originalPowerT[offset + frame]!;
				}

				binEnergy[bin] = energy;
			}

			const meanEnergy = binEnergy.reduce((sum, sample) => sum + sample, 0) / numBins;
			const energyThreshold = meanEnergy * 1e-4;

			for (let iter = 0; iter < iterations; iter++) {
				let powerT: Float32Array;

				if (iter === 0) {
					powerT = originalPowerT;
				} else {
					for (let ci = 0; ci < usedSize; ci++) {
						iterPowerT[ci] = Math.max(realT[ci]! * realT[ci]! + imagT[ci]! * imagT[ci]!, 1e-10);
					}

					powerT = iterPowerT;
				}

				for (let bin = 0; bin < numBins; bin++) {
					if (binEnergy[bin]! < energyThreshold) continue;

					const bo = bin * numFrames; // bin offset into flat arrays

					filterReal.fill(0);
					filterImag.fill(0);

					solveWpeFilter(realT, imagT, powerT, bo, numFrames, predictionDelay, filterLen, filterReal, filterImag, corrReal, corrImag, crossReal, crossImag, arWork, aiWork, brWork, biWork);

					// Apply prediction filter and subtract reverb estimate
					for (let frame = predictionDelay + filterLen; frame < numFrames; frame++) {
						let predR = 0;
						let predI = 0;

						for (let tap = 0; tap < filterLen; tap++) {
							const pastOffset = bo + frame - predictionDelay - tap - 1;
							const pR = realT[pastOffset]!;
							const pI = imagT[pastOffset]!;

							predR += filterReal[tap]! * pR - filterImag[tap]! * pI;
							predI += filterReal[tap]! * pI + filterImag[tap]! * pR;
						}

						const pos = bo + frame;
						const newR = realT[pos]! - predR;
						const newI = imagT[pos]! - predI;

						// Clamp: output power must not exceed original power
						const newPow = newR * newR + newI * newI;
						const origPow = originalPowerT[pos]!;

						if (newPow > origPow) {
							const scale = Math.sqrt(origPow / newPow);

							realT[pos] = newR * scale;
							imagT[pos] = newI * scale;
						} else {
							realT[pos] = newR;
							imagT[pos] = newI;
						}
					}
				}
			}

			// Transpose back to frame-major for iSTFT
			for (let frame = 0; frame < numFrames; frame++) {
				const re = stftResult.real[frame];
				const im = stftResult.imag[frame];

				if (!re || !im) continue;

				for (let bin = 0; bin < numBins; bin++) {
					re[bin] = realT[bin * numFrames + frame]!;
					im[bin] = imagT[bin * numFrames + frame]!;
				}
			}

			const dereverberated = istft(stftResult, hopSize, paddedLength, this.fftBackend, this.fftAddonOptions).subarray(0, frames);

			await buffer.write(0, replaceChannel(chunk, ch, dereverberated, channels));
		}
	}
}

export class DeReverbNode extends TransformNode<DeReverbProperties> {
	static override readonly moduleName = "De-Reverb (WPE)";
	static override readonly moduleDescription = "Reduce room reverb using Weighted Prediction Error — classical DSP, fully tunable, no model required";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeReverbNode {
		return TransformNode.is(value) && value.type[2] === "de-reverb";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-reverb"] as const;

	constructor(properties: DeReverbProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): DeReverbStream {
		return new DeReverbStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeReverbProperties>): DeReverbNode {
		return new DeReverbNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deReverb(options?: {
	sensitivity?: number;
	predictionDelay?: number;
	filterLength?: number;
	iterations?: number;
	vkfftAddonPath?: string;
	fftwAddonPath?: string;
	id?: string;
}): DeReverbNode {
	const sensitivity = Math.max(0, Math.min(1, options?.sensitivity ?? 0.5));

	return new DeReverbNode({
		predictionDelay: options?.predictionDelay ?? Math.round(2 + (1 - sensitivity) * 4),
		filterLength: options?.filterLength ?? Math.round(5 + sensitivity * 15),
		iterations: options?.iterations ?? Math.round(2 + sensitivity * 4),
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		id: options?.id,
	});
}
