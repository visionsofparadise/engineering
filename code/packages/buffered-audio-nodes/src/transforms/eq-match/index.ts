import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { AudioChunk, StreamContext } from "../../node";
import { initFftBackend, type FftBackend } from "../../utils/fft-backend";
import { readToBuffer } from "../../utils/read-to-buffer";
import { replaceChannel } from "../../utils/replace-channel";
import { istft, stft } from "../../utils/stft";

export const schema = z.object({
	referencePath: z.string().default("").describe("Reference Path"),
	smoothing: z
		.number()
		.min(0)
		.max(1)
		.multipleOf(0.01)
		.default(1 / 3)
		.describe("Smoothing"),
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

export interface EqMatchProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Analyzes a reference file's spectral profile and applies a correction filter
 * to match the target signal's spectrum to the reference.
 *
 * @see Valimaki, V., Reiss, J.D. (2016). "All About Audio Equalization: Solutions and
 *   Frontiers." Applied Sciences, 6(5), 129. https://doi.org/10.3390/app6050129
 */
export class EqMatchStream extends BufferedTransformStream<EqMatchProperties> {
	private referenceSpectrum?: Float32Array;
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };
	private initialized = false;

	override setup(input: ReadableStream<AudioChunk>, context: StreamContext): ReadableStream<AudioChunk> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super.setup(input, context);
	}

	private async ensureInitialized(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		const props = this.properties;
		const { buffer: refBuffer } = await readToBuffer(props.referencePath);
		const refFrames = refBuffer.frames;
		const chunk = await refBuffer.read(0, refFrames);
		const channel = chunk.samples[0];

		if (channel) {
			this.referenceSpectrum = computeAverageSpectrum(channel, this.sampleRate ?? 44100);
		}

		await refBuffer.close();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		await this.ensureInitialized();
		if (!this.referenceSpectrum) return;
		const props = this.properties;

		const frames = buffer.frames;
		const channels = buffer.channels;
		const fftSize = 2048;
		const hopSize = fftSize / 4;
		const halfSize = fftSize / 2 + 1;
		const paddedLength = Math.max(frames, fftSize);
		const numStftFrames = Math.floor((paddedLength - fftSize) / hopSize) + 1;
		const stftOutput = {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
		};

		const chunk = await buffer.read(0, frames);

		for (let ch = 0; ch < channels; ch++) {
			let channel = chunk.samples[ch];

			if (!channel) continue;

			if (channel.length < fftSize) {
				const padded = new Float32Array(fftSize);

				padded.set(channel);
				channel = padded;
			}

			const stftResult = stft(channel, fftSize, hopSize, stftOutput, this.fftBackend, this.fftAddonOptions);

			const inputSpectrum = averageSpectrumFromStft(stftResult, halfSize);
			const correctionDb = computeCorrection(this.referenceSpectrum, inputSpectrum, props.smoothing);
			const correctionLinear = correctionDb.map((db) => Math.pow(10, db / 20));

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

			const matched = istft(stftResult, hopSize, paddedLength, this.fftBackend, this.fftAddonOptions).subarray(0, frames);

			await buffer.write(0, replaceChannel(chunk, ch, matched, channels));
		}
	}
}

export class EqMatchNode extends TransformNode<EqMatchProperties> {
	static override readonly moduleName = "EQ Match";
	static override readonly moduleDescription = "Match frequency response to a reference profile";
	static override readonly schema = schema;
	static override is(value: unknown): value is EqMatchNode {
		return TransformNode.is(value) && value.type[2] === "eq-match";
	}

	override readonly type = ["buffered-audio-node", "transform", "eq-match"] as const;

	constructor(properties: EqMatchProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): EqMatchStream {
		return new EqMatchStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<EqMatchProperties>): EqMatchNode {
		return new EqMatchNode({ ...this.properties, previousProperties: this.properties, ...overrides });
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

function averageSpectrumFromStft(result: { real: Array<Float32Array>; imag: Array<Float32Array>; frames: number }, halfSize: number): Float32Array {
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
		vkfftAddonPath?: string;
		fftwAddonPath?: string;
		id?: string;
	},
): EqMatchNode {
	return new EqMatchNode({
		referencePath,
		smoothing: options?.smoothing ?? 1 / 3,
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		id: options?.id,
	});
}
