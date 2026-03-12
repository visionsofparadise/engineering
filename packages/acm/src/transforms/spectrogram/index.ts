import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { createFftWorkspace, fft, hanningWindow, type FftWorkspace } from "../../utils/stft";

export const schema = z.object({
	outputPath: z.string().default("").meta({ input: "file", mode: "save" }).describe("Output Path"),
	fftSize: z.number().min(256).max(8192).multipleOf(256).default(2048).describe("FFT Size"),
	hopSize: z.number().min(64).max(4096).multipleOf(64).default(512).describe("Hop Size"),
});

export type FrequencyScale = "linear" | "log";

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
	override readonly bufferSize = 0;
	override readonly latency = 0;

	private fileHandle?: FileHandle;
	private channels = 1;
	private linearBins = 0;
	private outputBins = 0;
	private numFrames = 0;
	private fileOffset = HEADER_SIZE;

	private windowCoefficients: Float32Array = new Float32Array(0);
	private workspace?: FftWorkspace;
	private channelBuffers: Array<Float32Array> = [];
	private channelBufferPositions: Array<number> = [];
	private totalSamplesReceived = 0;
	private nextHopAt = 0;
	private bandMappings?: ReadonlyArray<BandMapping>;

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.channels = context.channels;
		this.linearBins = this.properties.fftSize / 2 + 1;
		this.numFrames = 0;
		this.fileOffset = HEADER_SIZE;
		this.totalSamplesReceived = 0;
		this.nextHopAt = this.properties.fftSize;

		this.windowCoefficients = hanningWindow(this.properties.fftSize);
		this.workspace = createFftWorkspace(this.properties.fftSize);

		this.channelBuffers = [];
		this.channelBufferPositions = [];

		const isLog = (this.properties.frequencyScale ?? "log") === "log";

		if (isLog) {
			const numBands = this.properties.numBands ?? 512;
			const minFreq = this.properties.minFrequency ?? 20;
			const maxFreq = this.properties.maxFrequency ?? context.sampleRate / 2;
			this.bandMappings = computeBandMappings(numBands, minFreq, maxFreq, context.sampleRate, this.properties.fftSize);
			this.outputBins = numBands;
		} else {
			this.bandMappings = undefined;
			this.outputBins = this.linearBins;
		}

		for (let ch = 0; ch < context.channels; ch++) {
			this.channelBuffers.push(new Float32Array(this.properties.fftSize));
			this.channelBufferPositions.push(0);
		}
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.fileHandle = await open(this.properties.outputPath, "w");

		const isLog = (this.properties.frequencyScale ?? "log") === "log";
		const minFreq = this.properties.minFrequency ?? 20;
		const maxFreq = this.properties.maxFrequency ?? context.sampleRate / 2;

		const header = Buffer.alloc(HEADER_SIZE);
		header.writeUInt32LE(context.sampleRate, 0);
		header.writeUInt32LE(context.channels, 4);
		header.writeUInt32LE(this.properties.fftSize, 8);
		header.writeUInt32LE(this.properties.hopSize, 12);
		header.writeUInt32LE(0, 16);
		header.writeUInt32LE(this.outputBins, 20);
		header.writeUInt8(isLog ? 1 : 0, 24);
		header.writeFloatLE(minFreq, 25);
		header.writeFloatLE(maxFreq, 29);

		await this.fileHandle.write(header, 0, HEADER_SIZE, 0);
	}

	override _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> | void {
		this.processSpectrogramData(chunk);

		return buffer.append(chunk.samples);
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		return chunk;
	}

	private processSpectrogramData(chunk: AudioChunk): void {
		const { fftSize, hopSize } = this.properties;
		const frames = chunk.duration;

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < this.channels; ch++) {
				const channelBuffer = this.channelBuffers[ch];
				const position = this.channelBufferPositions[ch] ?? 0;

				if (channelBuffer) {
					if (position < fftSize) {
						channelBuffer[position] = chunk.samples[ch]?.[frame] ?? 0;
					} else {
						channelBuffer.copyWithin(0, 1);
						channelBuffer[fftSize - 1] = chunk.samples[ch]?.[frame] ?? 0;
					}
				}

				this.channelBufferPositions[ch] = position + 1;
			}

			this.totalSamplesReceived++;

			if (this.totalSamplesReceived >= this.nextHopAt) {
				this.computeFrame();

				this.nextHopAt += hopSize;
			}
		}
	}

	private computeFrame(): void {
		if (!this.fileHandle || !this.workspace) return;

		const { fftSize } = this.properties;
		const frameData = Buffer.alloc(this.outputBins * this.channels * 4);

		for (let ch = 0; ch < this.channels; ch++) {
			const channelBuffer = this.channelBuffers[ch];

			if (!channelBuffer) continue;

			const windowed = new Float32Array(fftSize);

			for (let index = 0; index < fftSize; index++) {
				windowed[index] = (channelBuffer[index] ?? 0) * (this.windowCoefficients[index] ?? 0);
			}

			const { re, im } = fft(windowed, this.workspace);

			if (this.bandMappings) {
				const magnitudes = new Float32Array(this.linearBins);
				for (let bin = 0; bin < this.linearBins; bin++) {
					const real = re[bin] ?? 0;
					const imag = im[bin] ?? 0;
					magnitudes[bin] = Math.sqrt(real * real + imag * imag);
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

						sum += (magnitudes[bin] ?? 0) * weight;
						weightSum += weight;
					}

					frameData.writeFloatLE(weightSum > 0 ? sum / weightSum : 0, (ch * this.outputBins + band) * 4);
				}
			} else {
				for (let bin = 0; bin < this.outputBins; bin++) {
					const real = re[bin] ?? 0;
					const imag = im[bin] ?? 0;
					const magnitude = Math.sqrt(real * real + imag * imag);

					frameData.writeFloatLE(magnitude, (ch * this.outputBins + bin) * 4);
				}
			}
		}

		void this.fileHandle.write(frameData, 0, frameData.length, this.fileOffset);
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

function computeBandMappings(
	numBands: number,
	minFreq: number,
	maxFreq: number,
	sampleRate: number,
	fftSize: number,
): ReadonlyArray<BandMapping> {
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
	});
}
