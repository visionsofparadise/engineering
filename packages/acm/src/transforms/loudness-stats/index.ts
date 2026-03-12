import { ChunkBuffer } from "../../chunk-buffer";
import { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { biquadFilter, preFilterCoefficients, rlbFilterCoefficients } from "../../utils/biquad";

export interface LoudnessStats {
	readonly integrated: number;
	readonly shortTerm: Array<number>;
	readonly momentary: Array<number>;
	readonly truePeak: number;
	readonly range: number;
}

export class LoudnessStatsModule extends TransformModule {
	static override readonly moduleName = "Loudness Stats";
	static override is(value: unknown): value is LoudnessStatsModule {
		return TransformModule.is(value) && value.type[2] === "loudness-stats";
	}

	override readonly type = ["async-module", "transform", "loudness-stats"] as const;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private measureSampleRate = 48000;
	private truePeakValue = 0;

	stats?: LoudnessStats;

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.measureSampleRate = context.sampleRate;
	}

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		await super._buffer(chunk, buffer);
		for (const channel of chunk.samples) {
			for (const sample of channel) {
				const abs = Math.abs(sample);

				if (abs > this.truePeakValue) {
					this.truePeakValue = abs;
				}
			}
		}
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const channels = buffer.channels;
		const frames = buffer.frames;
		const sampleRate = this.measureSampleRate;

		const kWeighted = await applyKWeighting(buffer, channels, frames, sampleRate);

		const blockSize400ms = Math.round(sampleRate * 0.4);
		const stepSize = Math.round(sampleRate * 0.1);
		const blockSize3s = sampleRate * 3;

		const momentary = computeBlockLoudness(kWeighted, channels, frames, blockSize400ms, stepSize);
		const shortTerm = computeBlockLoudness(kWeighted, channels, frames, blockSize3s, stepSize);

		const integrated = computeIntegratedLoudness(kWeighted, channels, frames, blockSize400ms, stepSize);

		const truePeak = 20 * Math.log10(Math.max(this.truePeakValue, 1e-10));

		const loudValues = momentary.filter((value) => value > -70);
		const range = loudValues.length >= 2 ? Math.max(...loudValues) - Math.min(...loudValues) : 0;

		this.stats = { integrated, shortTerm, momentary, truePeak, range };
	}

	clone(overrides?: Partial<TransformModuleProperties>): LoudnessStatsModule {
		return new LoudnessStatsModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

async function applyKWeighting(buffer: ChunkBuffer, channels: number, frames: number, sampleRate: number): Promise<Array<Float32Array>> {
	const result: Array<Float32Array> = [];

	for (let ch = 0; ch < channels; ch++) {
		const channelData = new Float32Array(frames);
		const chunkSize = 44100;
		let offset = 0;

		for await (const chunk of buffer.iterate(chunkSize)) {
			const samples = chunk.samples[ch];

			if (samples) {
				channelData.set(samples, offset);
			}

			offset += chunk.duration;
		}

		const filtered = applyPreFilter(channelData, sampleRate);
		const rlbFiltered = applyRlbFilter(filtered, sampleRate);
		result.push(rlbFiltered);
	}

	return result;
}

function applyPreFilter(samples: Float32Array, sampleRate: number): Float32Array {
	const { fb, fa } = preFilterCoefficients(sampleRate);
	return biquadFilter(samples, fb, fa);
}

function applyRlbFilter(samples: Float32Array, sampleRate: number): Float32Array {
	const { fb, fa } = rlbFilterCoefficients(sampleRate);
	return biquadFilter(samples, fb, fa);
}

function computeBlockLoudness(kWeighted: Array<Float32Array>, channels: number, frames: number, blockSize: number, stepSize: number): Array<number> {
	const results: Array<number> = [];

	for (let start = 0; start + blockSize <= frames; start += stepSize) {
		let sumMeanSquare = 0;

		for (let ch = 0; ch < channels; ch++) {
			const channel = kWeighted[ch];

			if (!channel) continue;

			let sum = 0;

			for (let index = start; index < start + blockSize; index++) {
				const sample = channel[index] ?? 0;
				sum += sample * sample;
			}

			sumMeanSquare += sum / blockSize;
		}

		const loudness = -0.691 + 10 * Math.log10(Math.max(sumMeanSquare, 1e-10));
		results.push(loudness);
	}

	return results;
}

function computeIntegratedLoudness(kWeighted: Array<Float32Array>, channels: number, frames: number, blockSize: number, stepSize: number): number {
	const blockLoudness = computeBlockLoudness(kWeighted, channels, frames, blockSize, stepSize);

	if (blockLoudness.length === 0) return -Infinity;

	const absoluteGated = blockLoudness.filter((value) => value > -70);

	if (absoluteGated.length === 0) return -Infinity;

	const absoluteMean = absoluteGated.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / absoluteGated.length;
	const relativeThreshold = 10 * Math.log10(absoluteMean) - 10;

	const relativeGated = absoluteGated.filter((value) => value > relativeThreshold);

	if (relativeGated.length === 0) return -Infinity;

	const relativeMean = relativeGated.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / relativeGated.length;

	return 10 * Math.log10(relativeMean);
}

export function loudnessStats(options?: { id?: string }): LoudnessStatsModule {
	return new LoudnessStatsModule({
		id: options?.id,
	});
}
