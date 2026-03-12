import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { detectFftBackend, type FftBackend } from "../../utils/fft-backend";
import { readToBuffer } from "../../utils/read-to-buffer";
import { istft, stft } from "../../utils/stft";

export const schema = z.object({
	referencePath: z.string().default("").describe("Reference Path"),
	smoothing: z.number().min(0).max(1).multipleOf(0.01).default(1 / 3).describe("Smoothing"),
});

export interface EqMatchProperties extends z.infer<typeof schema>, TransformModuleProperties {}

/**
 * Analyzes a reference file's spectral profile and applies a correction filter
 * to match the target signal's spectrum to the reference.
 *
 * @see Valimaki, V., Reiss, J.D. (2016). "All About Audio Equalization: Solutions and
 *   Frontiers." Applied Sciences, 6(5), 129. https://doi.org/10.3390/app6050129
 */
export class EqMatchModule extends TransformModule<EqMatchProperties> {
	static override readonly moduleName = "EQ Match";
	static override readonly moduleDescription = "Match frequency response to a reference profile";
	static override readonly schema = schema;
	static override is(value: unknown): value is EqMatchModule {
		return TransformModule.is(value) && value.type[2] === "eq-match";
	}

	override readonly type = ["async-module", "transform", "eq-match"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private matchSampleRate = 44100;
	private referenceSpectrum?: Float32Array;
	private fftBackend: FftBackend = "js";

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);
		this.matchSampleRate = context.sampleRate;
		this.fftBackend = detectFftBackend(context.executionProviders);
		await this.loadReference();
	}

	private async loadReference(): Promise<void> {
		const { buffer, context: _refContext } = await readToBuffer(this.properties.referencePath);
		const refFrames = buffer.frames;
		const chunk = await buffer.read(0, refFrames);
		const channel = chunk.samples[0];

		if (!channel) {
			await buffer.close();
			return;
		}

		this.referenceSpectrum = computeAverageSpectrum(channel, this.matchSampleRate);
		await buffer.close();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.referenceSpectrum) return;

		const frames = buffer.frames;
		const channels = buffer.channels;
		const fftSize = 2048;
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

			const inputSpectrum = computeAverageSpectrum(channel, this.matchSampleRate);
			const correctionDb = computeCorrection(this.referenceSpectrum, inputSpectrum, this.properties.smoothing);
			const correctionLinear = correctionDb.map((db) => Math.pow(10, db / 20));

			const stftResult = stft(channel, fftSize, hopSize, stftOutput, this.fftBackend);

			for (let frame = 0; frame < stftResult.frames; frame++) {
				const realFrame = stftResult.real[frame];
				const imagFrame = stftResult.imag[frame];

				if (!realFrame || !imagFrame) continue;

				for (let bin = 0; bin < realFrame.length; bin++) {
					const correctionIdx = Math.min(bin, correctionLinear.length - 1);
					const gain = correctionLinear[correctionIdx] ?? 1;

					realFrame[bin] = (realFrame[bin] ?? 0) * gain;
					imagFrame[bin] = (imagFrame[bin] ?? 0) * gain;
				}
			}

			const matched = istft(stftResult, hopSize, frames, this.fftBackend);
			const allChannels: Array<Float32Array> = [];

			for (let writeCh = 0; writeCh < channels; writeCh++) {
				allChannels.push(writeCh === ch ? matched : (chunk.samples[writeCh] ?? new Float32Array(frames)));
			}

			await buffer.write(0, allChannels);
		}
	}

	clone(overrides?: Partial<EqMatchProperties>): EqMatchModule {
		return new EqMatchModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function computeAverageSpectrum(signal: Float32Array, _sampleRate: number): Float32Array {
	const fftSize = 2048;
	const hopSize = fftSize / 4;
	const result = stft(signal, fftSize, hopSize);
	const halfSize = fftSize / 2 + 1;
	const avgMagnitude = new Float32Array(halfSize);

	for (let frame = 0; frame < result.frames; frame++) {
		const re = result.real[frame];
		const im = result.imag[frame];

		if (!re || !im) continue;

		for (let bin = 0; bin < halfSize; bin++) {
			const rVal = re[bin] ?? 0;
			const iVal = im[bin] ?? 0;
			avgMagnitude[bin] = (avgMagnitude[bin] ?? 0) + Math.sqrt(rVal * rVal + iVal * iVal);
		}
	}

	if (result.frames > 0) {
		for (let bin = 0; bin < halfSize; bin++) {
			avgMagnitude[bin] = (avgMagnitude[bin] ?? 0) / result.frames;
		}
	}

	return avgMagnitude;
}

function computeCorrection(reference: Float32Array, input: Float32Array, smoothingOctaves: number): Float32Array {
	const size = Math.min(reference.length, input.length);
	const correctionDb = new Float32Array(size);

	for (let bin = 0; bin < size; bin++) {
		const refDb = 20 * Math.log10(Math.max(reference[bin] ?? 0, 1e-10));
		const inDb = 20 * Math.log10(Math.max(input[bin] ?? 0, 1e-10));
		correctionDb[bin] = refDb - inDb;
	}

	return smoothSpectrum(correctionDb, smoothingOctaves);
}

function smoothSpectrum(spectrum: Float32Array, octaves: number): Float32Array {
	const smoothed = new Float32Array(spectrum.length);

	for (let bin = 1; bin < spectrum.length; bin++) {
		const lowerBin = Math.max(1, Math.round(bin / Math.pow(2, octaves / 2)));
		const upperBin = Math.min(spectrum.length - 1, Math.round(bin * Math.pow(2, octaves / 2)));

		let sum = 0;
		let count = 0;

		for (let neighbor = lowerBin; neighbor <= upperBin; neighbor++) {
			sum += spectrum[neighbor] ?? 0;
			count++;
		}

		smoothed[bin] = count > 0 ? sum / count : (spectrum[bin] ?? 0);
	}

	smoothed[0] = spectrum[0] ?? 0;

	return smoothed;
}

export function eqMatch(
	referencePath: string,
	options?: {
		smoothing?: number;
		id?: string;
	},
): EqMatchModule {
	return new EqMatchModule({
		referencePath,
		smoothing: options?.smoothing ?? 1 / 3,
		id: options?.id,
	});
}
