import { z } from "zod";
import type { AudioChunk, StreamContext } from "../node";
import { BufferedTargetStream, TargetNode, type TargetNodeProperties } from "../target";
import { WHOLE_FILE } from "../transform";
import { biquadFilter, preFilterCoefficients, rlbFilterCoefficients } from "../utils/biquad";

export const schema = z.object({});

export interface LoudnessStats {
	readonly integrated: number;
	readonly shortTerm: Array<number>;
	readonly momentary: Array<number>;
	readonly truePeak: number;
	readonly range: number;
}

export class LoudnessStatsStream extends BufferedTargetStream<TargetNodeProperties> {
	private channels = 0;
	private sampleRate = 0;
	private truePeakValue = 0;
	private channelBuffers: Array<Array<Float32Array>> = [];
	private totalFrames = 0;
	private _stats?: LoudnessStats;

	get stats(): LoudnessStats | undefined {
		return this._stats;
	}

	constructor(properties: TargetNodeProperties, context: StreamContext) {
		super(properties, context);
		this.channels = context.channels;
		this.sampleRate = context.sampleRate;
		for (let ch = 0; ch < this.channels; ch++) {
			this.channelBuffers.push([]);
		}
	}

	override async _write(chunk: AudioChunk): Promise<void> {
		for (let ch = 0; ch < this.channels; ch++) {
			const samples = chunk.samples[ch];
			if (!samples) continue;

			this.channelBuffers[ch]!.push(new Float32Array(samples));

			for (const sample of samples) {
				const abs = Math.abs(sample);
				if (abs > this.truePeakValue) {
					this.truePeakValue = abs;
				}
			}
		}

		this.totalFrames += chunk.duration;
	}

	override async _close(): Promise<void> {
		const channels = this.channels;
		const frames = this.totalFrames;
		const sampleRate = this.sampleRate;

		const kWeighted = applyKWeighting(this.channelBuffers, channels, frames, sampleRate);

		const blockSize400ms = Math.round(sampleRate * 0.4);
		const stepSize = Math.round(sampleRate * 0.1);
		const blockSize3s = sampleRate * 3;

		const momentary = computeBlockLoudness(kWeighted, channels, frames, blockSize400ms, stepSize);
		const shortTerm = computeBlockLoudness(kWeighted, channels, frames, blockSize3s, stepSize);

		const integrated = computeIntegratedLoudness(kWeighted, channels, frames, blockSize400ms, stepSize);

		const truePeak = 20 * Math.log10(Math.max(this.truePeakValue, 1e-10));

		const range = computeLra(shortTerm);

		this._stats = { integrated, shortTerm, momentary, truePeak, range };

		this.channelBuffers = [];
	}
}

export class LoudnessStatsNode extends TargetNode {
	static override readonly moduleName = "Loudness Stats";
	static override readonly moduleDescription = "Measure integrated loudness, true peak, loudness range, and short-term/momentary loudness per EBU R128";
	static override readonly schema = schema;

	static override is(value: unknown): value is LoudnessStatsNode {
		return TargetNode.is(value) && value.type[2] === "loudness-stats";
	}

	override readonly type = ["async-module", "target", "loudness-stats"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = WHOLE_FILE;

	private lastStream?: LoudnessStatsStream;

	get stats(): LoudnessStats | undefined {
		return this.lastStream?.stats;
	}

	protected override createStream(context: StreamContext): LoudnessStatsStream {
		return new LoudnessStatsStream(this.properties, context);
	}

	override createWritable(): WritableStream<AudioChunk> {
		if (!this.streamContext) throw new Error("Stream context not initialized");
		const stream = this.createStream(this.streamContext);
		this.lastStream = stream;
		return stream.createWritableStream();
	}

	override clone(overrides?: Partial<TargetNodeProperties>): LoudnessStatsNode {
		return new LoudnessStatsNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function flattenBuffers(chunks: Array<Float32Array>, totalFrames: number): Float32Array {
	const result = new Float32Array(totalFrames);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

function applyKWeighting(channelBuffers: Array<Array<Float32Array>>, channels: number, frames: number, sampleRate: number): Array<Float32Array> {
	const result: Array<Float32Array> = [];

	for (let ch = 0; ch < channels; ch++) {
		const channelData = flattenBuffers(channelBuffers[ch]!, frames);
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

function computeLra(shortTermLoudness: Array<number>): number {
	const absoluteGated = shortTermLoudness.filter((value) => value > -70);

	if (absoluteGated.length < 2) return 0;

	const absoluteMean = absoluteGated.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / absoluteGated.length;
	const relativeThreshold = 10 * Math.log10(absoluteMean) - 20;

	const relativeGated = absoluteGated.filter((value) => value > relativeThreshold);

	if (relativeGated.length < 2) return 0;

	relativeGated.sort((lhs, rhs) => lhs - rhs);

	const p10Index = Math.floor(relativeGated.length * 0.1);
	const p95Index = Math.min(Math.ceil(relativeGated.length * 0.95) - 1, relativeGated.length - 1);

	return (relativeGated[p95Index] ?? 0) - (relativeGated[p10Index] ?? 0);
}

export function loudnessStats(options?: { id?: string }): LoudnessStatsNode {
	return new LoudnessStatsNode({
		id: options?.id,
	});
}
