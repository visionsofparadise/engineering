/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { detectFftBackend, getFftAddon } from "../../utils/fft-backend";
import { createFftWorkspace, fft, hanningWindow, type FftWorkspace } from "../../utils/stft";

export const schema = z.object({
	outputPath: z.string().default("").meta({ input: "file", mode: "save" }).describe("Output Path"),
	fftSize: z.number().min(256).max(8192).multipleOf(256).default(2048).describe("FFT Size"),
	hopSize: z.number().min(64).max(8192).multipleOf(64).default(512).describe("Hop Size"),
	fftwAddonPath: z.string().default("").meta({ input: "file", mode: "open", binary: "fftw-addon" }).describe("FFTW Addon"),
});

export type FrequencyScale = "linear" | "log" | "mel" | "erb";

export interface SpectrogramProperties extends z.infer<typeof schema>, TransformModuleProperties {
	readonly frequencyScale?: FrequencyScale;
	readonly numBands?: number;
	readonly minFrequency?: number;
	readonly maxFrequency?: number;
}

const HEADER_SIZE = 33;

interface BandMapping {
	readonly binStart: number;
	readonly binEnd: number;
	readonly weightStart: number;
	readonly weightEnd: number;
}

export class SpectrogramModule extends TransformModule<SpectrogramProperties> {
	static override readonly moduleName = "Spectrogram";
	static override readonly moduleDescription = "Generate spectrogram visualization data";
	static override readonly schema = schema;

	static override is(value: unknown): value is SpectrogramModule {
		return TransformModule.is(value) && value.type[2] === "spectrogram";
	}

	override readonly type = ["async-module", "transform", "spectrogram"] as const;
	override get bufferSize(): number {
		const targetBytes = 8 * 1024 * 1024;
		const framesPerBatch = Math.max(1, Math.floor(targetBytes / (this.properties.fftSize * 4)));
		return this.properties.hopSize * framesPerBatch;
	}

	override get overlap(): number {
		return Math.max(0, this.properties.fftSize - this.properties.hopSize);
	}

	override readonly latency = 0;

	private fileHandle?: FileHandle;
	private channels = 1;
	private linearBins = 0;
	private outputBins = 0;
	private numFrames = 0;
	private fileOffset = HEADER_SIZE;

	private windowCoefficients: Float32Array = new Float32Array(0);
	private workspace?: FftWorkspace;
	private addon: ReturnType<typeof getFftAddon> = null;
	private bandMappings?: ReadonlyArray<BandMapping>;

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.channels = context.channels;
		this.linearBins = this.properties.fftSize / 2 + 1;
		this.numFrames = 0;
		this.fileOffset = HEADER_SIZE;

		this.windowCoefficients = hanningWindow(this.properties.fftSize);
		this.workspace = createFftWorkspace(this.properties.fftSize);

		const fftAddonOptions = { fftwPath: this.properties.fftwAddonPath || undefined };
		const fftBackend = detectFftBackend(context.executionProviders, fftAddonOptions);

		this.addon = getFftAddon(fftBackend, fftAddonOptions);

		const scale = this.properties.frequencyScale ?? "log";
		const numBands = this.properties.numBands ?? 512;
		const minFreq = this.properties.minFrequency ?? 20;
		const maxFreq = this.properties.maxFrequency ?? context.sampleRate / 2;

		if (scale === "linear") {
			this.bandMappings = undefined;
			this.outputBins = this.linearBins;
		} else {
			const computeFn = scale === "mel" ? computeMelBandMappings : scale === "erb" ? computeErbBandMappings : computeLogBandMappings;

			this.bandMappings = computeFn(numBands, minFreq, maxFreq, context.sampleRate, this.properties.fftSize);
			this.outputBins = numBands;
		}
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.fileHandle = await open(this.properties.outputPath, "w");

		const scale = this.properties.frequencyScale ?? "log";
		const minFreq = this.properties.minFrequency ?? 20;
		const maxFreq = this.properties.maxFrequency ?? context.sampleRate / 2;

		const header = Buffer.alloc(HEADER_SIZE);
		header.writeUInt32LE(context.sampleRate, 0);
		header.writeUInt32LE(context.channels, 4);
		header.writeUInt32LE(this.properties.fftSize, 8);
		header.writeUInt32LE(this.properties.hopSize, 12);
		header.writeUInt32LE(0, 16);
		header.writeUInt32LE(this.outputBins, 20);
		header.writeUInt8(FREQUENCY_SCALE_BYTE[scale], 24);
		header.writeFloatLE(minFreq, 25);
		header.writeFloatLE(maxFreq, 29);

		await this.fileHandle.write(header, 0, HEADER_SIZE, 0);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.fileHandle || !this.workspace) return;

		const { fftSize, hopSize } = this.properties;
		const { addon } = this;

		const halfSize = this.linearBins;
		const magScale = 2 / fftSize;
		const totalSamples = buffer.frames;
		const batchFrames = totalSamples >= fftSize ? Math.floor((totalSamples - fftSize) / hopSize) + 1 : 0;

		if (batchFrames === 0) return;

		const chunk = await buffer.read(0, totalSamples);

		for (let ch = 0; ch < this.channels; ch++) {
			const samples = chunk.samples[ch]!;

			if (addon) {
				const batchInput = new Float32Array(fftSize * batchFrames);

				for (let fi = 0; fi < batchFrames; fi++) {
					const offset = fi * hopSize;
					const destOffset = fi * fftSize;

					for (let si = 0; si < fftSize; si++) {
						batchInput[destOffset + si] = samples[offset + si]! * this.windowCoefficients[si]!;
					}
				}

				const { re: batchRe, im: batchIm } = addon.batchFft(batchInput, fftSize, batchFrames);

				for (let fi = 0; fi < batchFrames; fi++) {
					this.writeFrame(ch, batchRe, batchIm, fi * halfSize, halfSize, magScale);
				}
			} else {
				const windowed = new Float32Array(fftSize);

				for (let fi = 0; fi < batchFrames; fi++) {
					const offset = fi * hopSize;

					for (let si = 0; si < fftSize; si++) {
						windowed[si] = samples[offset + si]! * this.windowCoefficients[si]!;
					}

					const { re, im } = fft(windowed, this.workspace);

					this.writeFrame(ch, re, im, 0, halfSize, magScale);
				}
			}
		}
	}

	private writeFrame(ch: number, re: Float32Array, im: Float32Array, reOffset: number, halfSize: number, magScale: number): void {
		const frameData = Buffer.alloc(this.outputBins * this.channels * 4);

		if (this.bandMappings) {
			const magnitudes = new Float32Array(halfSize);

			for (let bin = 0; bin < halfSize; bin++) {
				const real = re[reOffset + bin]!;
				const imag = im[reOffset + bin]!;
				magnitudes[bin] = Math.sqrt(real * real + imag * imag) * magScale;
			}

			for (let band = 0; band < this.outputBins; band++) {
				const mapping = this.bandMappings[band];

				if (!mapping) continue;

				let sum = 0;
				let weightSum = 0;

				for (let bin = mapping.binStart; bin <= mapping.binEnd; bin++) {
					let weight = 1;

					if (bin === mapping.binStart) weight = mapping.weightStart;
					else if (bin === mapping.binEnd) weight = mapping.weightEnd;

					sum += magnitudes[bin]! * weight;
					weightSum += weight;
				}

				frameData.writeFloatLE(weightSum > 0 ? sum / weightSum : 0, (ch * this.outputBins + band) * 4);
			}
		} else {
			for (let bin = 0; bin < this.outputBins; bin++) {
				const real = re[reOffset + bin]!;
				const imag = im[reOffset + bin]!;
				const magnitude = Math.sqrt(real * real + imag * imag) * magScale;

				frameData.writeFloatLE(magnitude, (ch * this.outputBins + bin) * 4);
			}
		}

		void this.fileHandle!.write(frameData, 0, frameData.length, this.fileOffset);

		this.fileOffset += frameData.length;
		this.numFrames++;
	}

	protected override async _teardown(): Promise<void> {
		if (!this.fileHandle) return;

		const header = Buffer.alloc(4);
		header.writeUInt32LE(this.numFrames, 0);

		await this.fileHandle.write(header, 0, 4, 16);
		await this.fileHandle.close();
		this.fileHandle = undefined;
	}

	clone(overrides?: Partial<SpectrogramProperties>): SpectrogramModule {
		return new SpectrogramModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export const FREQUENCY_SCALE_BYTE: Record<FrequencyScale, number> = { linear: 0, log: 1, mel: 2, erb: 3 };

function freqToMel(freq: number): number {
	return 2595 * Math.log10(1 + freq / 700);
}

function melToFreq(mel: number): number {
	return 700 * (Math.pow(10, mel / 2595) - 1);
}

function freqToErb(freq: number): number {
	return 21.4 * Math.log10(1 + 0.00437 * freq);
}

function erbToFreq(erb: number): number {
	return (Math.pow(10, erb / 21.4) - 1) / 0.00437;
}

function computeScaledBandMappings(
	numBands: number,
	minFreq: number,
	maxFreq: number,
	sampleRate: number,
	fftSize: number,
	toScale: (f: number) => number,
	fromScale: (s: number) => number,
): ReadonlyArray<BandMapping> {
	const scaleMin = toScale(minFreq);
	const scaleMax = toScale(maxFreq);
	const scaleStep = (scaleMax - scaleMin) / numBands;
	const binWidth = sampleRate / fftSize;
	const numLinearBins = fftSize / 2 + 1;

	const mappings: Array<BandMapping> = [];

	for (let band = 0; band < numBands; band++) {
		const freqLow = fromScale(scaleMin + band * scaleStep);
		const freqHigh = fromScale(scaleMin + (band + 1) * scaleStep);

		const exactBinLow = freqLow / binWidth;
		const exactBinHigh = freqHigh / binWidth;

		const binStart = Math.max(0, Math.floor(exactBinLow));
		const binEnd = Math.min(numLinearBins - 1, Math.ceil(exactBinHigh));

		const weightStart = 1 - (exactBinLow - binStart);
		const weightEnd = 1 - (binEnd - exactBinHigh);

		mappings.push({
			binStart,
			binEnd: Math.max(binStart, binEnd),
			weightStart: Math.max(0, Math.min(1, weightStart)),
			weightEnd: Math.max(0, Math.min(1, weightEnd)),
		});
	}

	return mappings;
}

function computeMelBandMappings(numBands: number, minFreq: number, maxFreq: number, sampleRate: number, fftSize: number): ReadonlyArray<BandMapping> {
	return computeScaledBandMappings(numBands, minFreq, maxFreq, sampleRate, fftSize, freqToMel, melToFreq);
}

function computeErbBandMappings(numBands: number, minFreq: number, maxFreq: number, sampleRate: number, fftSize: number): ReadonlyArray<BandMapping> {
	return computeScaledBandMappings(numBands, minFreq, maxFreq, sampleRate, fftSize, freqToErb, erbToFreq);
}

function computeLogBandMappings(numBands: number, minFreq: number, maxFreq: number, sampleRate: number, fftSize: number): ReadonlyArray<BandMapping> {
	const logMin = Math.log(minFreq);
	const logMax = Math.log(maxFreq);
	const logStep = (logMax - logMin) / numBands;
	const binWidth = sampleRate / fftSize;
	const numLinearBins = fftSize / 2 + 1;

	const mappings: Array<BandMapping> = [];

	for (let band = 0; band < numBands; band++) {
		const freqLow = Math.exp(logMin + band * logStep);
		const freqHigh = Math.exp(logMin + (band + 1) * logStep);

		const exactBinLow = freqLow / binWidth;
		const exactBinHigh = freqHigh / binWidth;

		const binStart = Math.max(0, Math.floor(exactBinLow));
		const binEnd = Math.min(numLinearBins - 1, Math.ceil(exactBinHigh));

		const weightStart = 1 - (exactBinLow - binStart);
		const weightEnd = 1 - (binEnd - exactBinHigh);

		mappings.push({
			binStart,
			binEnd: Math.max(binStart, binEnd),
			weightStart: Math.max(0, Math.min(1, weightStart)),
			weightEnd: Math.max(0, Math.min(1, weightEnd)),
		});
	}

	return mappings;
}

export function spectrogram(
	outputPath: string,
	options?: {
		fftSize?: number;
		hopSize?: number;
		frequencyScale?: FrequencyScale;
		numBands?: number;
		minFrequency?: number;
		maxFrequency?: number;
		fftwAddonPath?: string;
	},
): SpectrogramModule {
	return new SpectrogramModule({
		outputPath,
		fftSize: options?.fftSize ?? 2048,
		hopSize: options?.hopSize ?? 512,
		frequencyScale: options?.frequencyScale,
		numBands: options?.numBands,
		minFrequency: options?.minFrequency,
		maxFrequency: options?.maxFrequency,
		fftwAddonPath: options?.fftwAddonPath ?? "",
	});
}
