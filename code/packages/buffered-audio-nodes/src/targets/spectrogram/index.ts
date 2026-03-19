/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import { BufferedTargetStream, TargetNode, type TargetNodeProperties } from "..";
import type { AudioChunk, StreamContext } from "../../node";
import { WHOLE_FILE } from "../../transforms";
import { detectFftBackend, getFftAddon } from "../../utils/fft-backend";
import { createFftWorkspace, fft, hanningWindow, type FftWorkspace } from "../../utils/stft";

export const schema = z.object({
	outputPath: z.string().default("").meta({ input: "file", mode: "save" }).describe("Output Path"),
	fftSize: z.number().min(256).max(8192).multipleOf(256).default(2048).describe("FFT Size"),
	hopSize: z.number().min(64).max(8192).multipleOf(64).default(512).describe("Hop Size"),
	fftwAddonPath: z.string().default("").meta({ input: "file", mode: "open", binary: "fftw-addon" }).describe("FFTW Addon"),
});

export type FrequencyScale = "linear" | "log" | "mel" | "erb";

export interface SpectrogramProperties extends z.infer<typeof schema>, TargetNodeProperties {
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

export class SpectrogramStream extends BufferedTargetStream<SpectrogramProperties> {
	private fileHandle?: FileHandle;
	private channels = 0;
	private linearBins = 0;
	private outputBins = 0;
	private numFrames = 0;
	private fileOffset = HEADER_SIZE;

	private windowCoefficients: Float32Array = new Float32Array(0);
	private workspace?: FftWorkspace;
	private addon: ReturnType<typeof getFftAddon> = null;
	private bandMappings?: ReadonlyArray<BandMapping>;
	private magnitudes: Float32Array = new Float32Array(0);

	private sampleBuffers: Array<Float32Array> = [];
	private sampleBufferOffset = 0;
	private sampleBufferCapacity = 0;

	private writeBuffer?: Buffer;
	private writeBufferOffset = 0;
	private writeBufferFileOffset = HEADER_SIZE;
	private readonly WRITE_BATCH_FRAMES = 1000;

	private initialized = false;

	private async lazyInit(chunk: AudioChunk): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		this.channels = chunk.samples.length;
		this.linearBins = this.properties.fftSize / 2 + 1;

		this.windowCoefficients = hanningWindow(this.properties.fftSize);
		this.workspace = createFftWorkspace(this.properties.fftSize);

		const fftAddonOptions = { fftwPath: this.properties.fftwAddonPath || undefined };
		const fftBackend = detectFftBackend(this.context.executionProviders, fftAddonOptions);
		this.addon = getFftAddon(fftBackend, fftAddonOptions);

		const scale = this.properties.frequencyScale ?? "log";
		const numBands = this.properties.numBands ?? 512;
		const minFreq = this.properties.minFrequency ?? 20;
		const maxFreq = this.properties.maxFrequency ?? chunk.sampleRate / 2;

		if (scale === "linear") {
			this.bandMappings = undefined;
			this.outputBins = this.linearBins;
		} else {
			const computeFn = scale === "mel" ? computeMelBandMappings : scale === "erb" ? computeErbBandMappings : computeLogBandMappings;
			this.bandMappings = computeFn(numBands, minFreq, maxFreq, chunk.sampleRate, this.properties.fftSize);
			this.outputBins = numBands;
		}

		this.magnitudes = new Float32Array(this.linearBins);
		this.numFrames = 0;
		this.fileOffset = HEADER_SIZE;

		this.sampleBufferCapacity = this.properties.fftSize + (8 * 1024 * 1024) / 4;
		this.sampleBuffers = [];
		for (let ch = 0; ch < this.channels; ch++) {
			this.sampleBuffers.push(new Float32Array(this.sampleBufferCapacity));
		}
		this.sampleBufferOffset = 0;

		this.fileHandle = await open(this.properties.outputPath, "w");

		const header = Buffer.alloc(HEADER_SIZE);
		header.writeUInt32LE(chunk.sampleRate, 0);
		header.writeUInt32LE(this.channels, 4);
		header.writeUInt32LE(this.properties.fftSize, 8);
		header.writeUInt32LE(this.properties.hopSize, 12);
		header.writeUInt32LE(0, 16);
		header.writeUInt32LE(this.outputBins, 20);
		header.writeUInt8(FREQUENCY_SCALE_BYTE[scale], 24);
		header.writeFloatLE(minFreq, 25);
		header.writeFloatLE(maxFreq, 29);

		await this.fileHandle.write(header, 0, HEADER_SIZE, 0);
	}

	override async _write(chunk: AudioChunk): Promise<void> {
		await this.lazyInit(chunk);

		const frames = chunk.samples[0]?.length ?? 0;

		if (this.sampleBufferOffset + frames > this.sampleBufferCapacity) {
			const newCapacity = Math.max(this.sampleBufferCapacity * 2, this.sampleBufferOffset + frames);
			for (let ch = 0; ch < this.channels; ch++) {
				const newBuf = new Float32Array(newCapacity);
				newBuf.set(this.sampleBuffers[ch]!.subarray(0, this.sampleBufferOffset));
				this.sampleBuffers[ch] = newBuf;
			}
			this.sampleBufferCapacity = newCapacity;
		}

		for (let ch = 0; ch < this.channels; ch++) {
			const src = chunk.samples[ch];
			if (!src) continue;
			this.sampleBuffers[ch]!.set(src, this.sampleBufferOffset);
		}

		this.sampleBufferOffset += frames;

		await this.processAccumulatedSamples(false);
	}

	override async _close(): Promise<void> {
		await this.processAccumulatedSamples(true);

		if (this.writeBuffer && this.writeBufferOffset > 0) {
			await this.fileHandle!.write(this.writeBuffer, 0, this.writeBufferOffset, this.writeBufferFileOffset);
			this.writeBufferOffset = 0;
		}
		this.writeBuffer = undefined;

		const header = Buffer.alloc(4);
		header.writeUInt32LE(this.numFrames, 0);

		await this.fileHandle!.write(header, 0, 4, 16);
		await this.fileHandle!.close();
		this.fileHandle = undefined;
	}

	private async processAccumulatedSamples(flush: boolean): Promise<void> {
		const { fftSize, hopSize } = this.properties;
		const { addon } = this;
		const halfSize = this.linearBins;
		const magScale = 2 / fftSize;

		if (flush && this.sampleBufferOffset > 0 && this.sampleBufferOffset < fftSize) {
			for (let ch = 0; ch < this.channels; ch++) {
				const buf = this.sampleBuffers[ch]!;
				buf.fill(0, this.sampleBufferOffset, fftSize);
			}
			this.sampleBufferOffset = fftSize;
		}

		if (this.sampleBufferOffset < fftSize) return;

		const batchFrames = Math.floor((this.sampleBufferOffset - fftSize) / hopSize) + 1;
		if (batchFrames === 0) return;

		const frameByteSize = this.outputBins * this.channels * 4;
		const batchBytes = this.WRITE_BATCH_FRAMES * frameByteSize;
		if (!this.writeBuffer) {
			this.writeBuffer = Buffer.alloc(batchBytes);
			this.writeBufferOffset = 0;
			this.writeBufferFileOffset = this.fileOffset;
		}

		for (let ch = 0; ch < this.channels; ch++) {
			const samples = this.sampleBuffers[ch]!;

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
					await this.writeFrame(ch, batchRe, batchIm, fi * halfSize, halfSize, magScale);
				}
			} else {
				const windowed = new Float32Array(fftSize);

				for (let fi = 0; fi < batchFrames; fi++) {
					const offset = fi * hopSize;

					for (let si = 0; si < fftSize; si++) {
						windowed[si] = samples[offset + si]! * this.windowCoefficients[si]!;
					}

					const { re, im } = fft(windowed, this.workspace);

					await this.writeFrame(ch, re, im, 0, halfSize, magScale);
				}
			}
		}

		await this.flushWriteBuffer();

		const keepFrom = batchFrames * hopSize;
		const keepCount = this.sampleBufferOffset - keepFrom;

		if (keepCount > 0) {
			for (let ch = 0; ch < this.channels; ch++) {
				const buf = this.sampleBuffers[ch]!;
				buf.copyWithin(0, keepFrom, keepFrom + keepCount);
			}
		}
		this.sampleBufferOffset = keepCount > 0 ? keepCount : 0;
	}

	private async writeFrame(ch: number, re: Float32Array, im: Float32Array, reOffset: number, halfSize: number, magScale: number): Promise<void> {
		const frameByteSize = this.outputBins * this.channels * 4;

		if (this.writeBuffer && this.writeBufferOffset + frameByteSize > this.writeBuffer.length) {
			await this.flushWriteBuffer();
		}

		const buf = this.writeBuffer;
		if (!buf) return;
		const offset = this.writeBufferOffset;

		if (this.bandMappings) {
			const magnitudes = this.magnitudes;

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

				buf.writeFloatLE(weightSum > 0 ? sum / weightSum : 0, offset + (ch * this.outputBins + band) * 4);
			}
		} else {
			for (let bin = 0; bin < this.outputBins; bin++) {
				const real = re[reOffset + bin]!;
				const imag = im[reOffset + bin]!;
				const magnitude = Math.sqrt(real * real + imag * imag) * magScale;

				buf.writeFloatLE(magnitude, offset + (ch * this.outputBins + bin) * 4);
			}
		}

		this.writeBufferOffset += frameByteSize;
		this.fileOffset += frameByteSize;
		this.numFrames++;
	}

	private async flushWriteBuffer(): Promise<void> {
		if (!this.writeBuffer || this.writeBufferOffset === 0) return;

		await this.fileHandle!.write(this.writeBuffer, 0, this.writeBufferOffset, this.writeBufferFileOffset);
		this.writeBufferFileOffset += this.writeBufferOffset;
		this.writeBufferOffset = 0;
	}
}

export class SpectrogramNode extends TargetNode<SpectrogramProperties> {
	static override readonly moduleName = "Spectrogram";
	static override readonly moduleDescription = "Generate spectrogram visualization data";
	static override readonly schema = schema;

	static override is(value: unknown): value is SpectrogramNode {
		return TargetNode.is(value) && value.type[2] === "spectrogram";
	}

	override readonly type = ["async-module", "target", "spectrogram"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = WHOLE_FILE;

	override createStream(context: StreamContext): SpectrogramStream {
		return new SpectrogramStream(this.properties, context);
	}

	override clone(overrides?: Partial<SpectrogramProperties>): SpectrogramNode {
		return new SpectrogramNode({ ...this.properties, previousProperties: this.properties, ...overrides });
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
): SpectrogramNode {
	return new SpectrogramNode({
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
