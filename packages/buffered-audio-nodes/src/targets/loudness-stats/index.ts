import { z } from "zod";
import { BufferedTargetStream, TargetNode, type TargetNodeProperties } from "..";
import type { AudioChunk } from "../../node";
import { WHOLE_FILE } from "../../transforms";
import { applyKWeighting, computeBlockLoudness, computeIntegratedLoudness, computeLra } from "./utils/measurement";

export const schema = z.object({});

export interface LoudnessStats {
	readonly integrated: number;
	readonly shortTerm: Array<number>;
	readonly momentary: Array<number>;
	readonly truePeak: number;
	readonly range: number;
}

export class LoudnessStatsStream extends BufferedTargetStream {
	private channels = 0;
	private sampleRate = 0;
	private truePeakValue = 0;
	private channelBuffers: Array<Array<Float32Array>> = [];
	private totalFrames = 0;
	private _stats?: LoudnessStats;
	private statsInitialized = false;

	get stats(): LoudnessStats | undefined {
		return this._stats;
	}

	private ensureInit(chunk: AudioChunk): void {
		if (this.statsInitialized) return;
		this.statsInitialized = true;
		this.channels = chunk.samples.length;
		this.sampleRate = chunk.sampleRate;
		for (let ch = 0; ch < this.channels; ch++) {
			this.channelBuffers.push([]);
		}
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	override async _write(chunk: AudioChunk): Promise<void> {
		this.ensureInit(chunk);
		for (let ch = 0; ch < this.channels; ch++) {
			const samples = chunk.samples[ch];

			if (!samples) continue;

			const channelBuffer = this.channelBuffers[ch];

			if (channelBuffer) channelBuffer.push(new Float32Array(samples));

			for (const sample of samples) {
				const abs = Math.abs(sample);

				if (abs > this.truePeakValue) {
					this.truePeakValue = abs;
				}
			}
		}

		this.totalFrames += chunk.samples[0]?.length ?? 0;
	}

	// eslint-disable-next-line @typescript-eslint/require-await
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

	override readonly type = ["buffered-audio-node", "target", "loudness-stats"] as const;

	constructor(properties?: TargetNodeProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	get stats(): LoudnessStats | undefined {
		const last = this.streams[this.streams.length - 1];

		return last instanceof LoudnessStatsStream ? last.stats : undefined;
	}

	override createStream(): LoudnessStatsStream {
		return new LoudnessStatsStream(this.properties);
	}

	override clone(overrides?: Partial<TargetNodeProperties>): LoudnessStatsNode {
		return new LoudnessStatsNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function loudnessStats(options?: { id?: string }): LoudnessStatsNode {
	return new LoudnessStatsNode({
		id: options?.id,
	});
}
