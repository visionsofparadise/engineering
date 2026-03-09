import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export interface LoudnessStats {
	readonly integrated: number;
	readonly shortTerm: Array<number>;
	readonly momentary: Array<number>;
	readonly truePeak: number;
	readonly range: number;
}

export class LoudnessStatsModule extends TransformModule {
	static override is(value: unknown): value is LoudnessStatsModule {
		return TransformModule.is(value) && value.type[2] === "loudness-stats";
	}

	readonly type = ["async-module", "transform", "loudness-stats"] as const;
	readonly properties: TransformModuleProperties;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private measureSampleRate = 48000;
	private truePeakValue = 0;

	stats?: LoudnessStats;

	constructor(properties?: AudioChainModuleInput<TransformModuleProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties?.targets ?? [] };
	}

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
	const channelData = new Float32Array(frames);
	const filterBuf1 = new Float32Array(frames);
	const filterBuf2 = new Float32Array(frames);

	for (let ch = 0; ch < channels; ch++) {
		channelData.fill(0);
		const chunkSize = 44100;
		let offset = 0;

		for await (const chunk of buffer.iterate(chunkSize)) {
			const samples = chunk.samples[ch];

			if (samples) {
				channelData.set(samples, offset);
			}

			offset += chunk.duration;
		}

		const filtered = applyPreFilter(channelData, sampleRate, filterBuf1);
		const rlbFiltered = applyRlbFilter(filtered, sampleRate, filterBuf2);
		result.push(Float32Array.from(rlbFiltered));
	}

	return result;
}

interface BiquadCoefficients {
	fb: [number, number, number];
	fa: [number, number, number];
}

function applyPreFilter(samples: Float32Array, sampleRate: number, output: Float32Array): Float32Array {
	const { fb, fa } = preFilterCoefficients(sampleRate);
	return biquadFilter(samples, fb, fa, output);
}

function applyRlbFilter(samples: Float32Array, sampleRate: number, output: Float32Array): Float32Array {
	const { fb, fa } = rlbFilterCoefficients(sampleRate);
	return biquadFilter(samples, fb, fa, output);
}

function preFilterCoefficients(sampleRate: number): BiquadCoefficients {
	if (sampleRate === 48000) {
		return {
			fb: [1.53512485958697, -2.69169618940638, 1.19839281085285],
			fa: [1.0, -1.69065929318241, 0.73248077421585],
		};
	}

	const freq = 1681.974450955533;
	const gain = 3.999843853973347;
	const quality = 0.7071752369554196;

	const kk = Math.tan((Math.PI * freq) / sampleRate);
	const vh = Math.pow(10, gain / 20);
	const vb = Math.pow(vh, 0.4996667741545416);
	const a0 = 1 + kk / quality + kk * kk;

	return {
		fb: [(vh + (vb * kk) / quality + kk * kk) / a0, (2 * (kk * kk - vh)) / a0, (vh - (vb * kk) / quality + kk * kk) / a0],
		fa: [1.0, (2 * (kk * kk - 1)) / a0, (1 - kk / quality + kk * kk) / a0],
	};
}

function rlbFilterCoefficients(sampleRate: number): BiquadCoefficients {
	if (sampleRate === 48000) {
		return {
			fb: [1.0, -2.0, 1.0],
			fa: [1.0, -1.99004745483398, 0.99007225036621],
		};
	}

	const freq = 38.13547087602444;
	const quality = 0.5003270373238773;

	const kk = Math.tan((Math.PI * freq) / sampleRate);
	const a0 = 1 + kk / quality + kk * kk;

	return {
		fb: [1 / a0, -2 / a0, 1 / a0],
		fa: [1.0, (2 * (kk * kk - 1)) / a0, (1 - kk / quality + kk * kk) / a0],
	};
}

function biquadFilter(samples: Float32Array, fb: [number, number, number], fa: [number, number, number], output: Float32Array): Float32Array {
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;

	for (let index = 0; index < samples.length; index++) {
		const x0 = samples[index] ?? 0;
		const y0 = fb[0] * x0 + fb[1] * x1 + fb[2] * x2 - fa[1] * y1 - fa[2] * y2;

		output[index] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}

	return output;
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
