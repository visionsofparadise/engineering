import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "buffered-audio-nodes-core";
import { computeRms, computeTargetGain } from "./utils/rms";

export const schema = z.object({
	target: z.number().min(-60).max(0).multipleOf(1).default(-20).describe("Target"),
	window: z.number().min(0.01).max(5).multipleOf(0.01).default(0.5).describe("Window"),
	speed: z.number().min(0.01).max(1).multipleOf(0.01).default(0.1).describe("Speed"),
	maxGain: z.number().min(0).max(40).multipleOf(1).default(12).describe("Max Gain"),
	maxCut: z.number().min(0).max(40).multipleOf(1).default(12).describe("Max Cut"),
});

export interface LevelerProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class LevelerStream extends BufferedTransformStream<LevelerProperties> {
	private windowSamples = 0;
	private currentGainDb = 0;
	private windowSeconds: number;

	constructor(properties: LevelerProperties) {
		super(properties);
		this.windowSeconds = this.properties.window;
	}

	override _buffer(chunk: AudioChunk, buffer: ChunkBuffer): void | Promise<void> {
		if (this.bufferSize === 0) {
			this.bufferSize = Math.round(chunk.sampleRate * this.properties.window);
		}

		return super._buffer(chunk, buffer);
	}

	override _process(_buffer: ChunkBuffer): void {
		// Processing happens in _unbuffer
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		if (this.windowSamples === 0) {
			this.windowSamples = Math.round(this.properties.window * chunk.sampleRate);
		}

		const { target, speed, maxGain, maxCut } = this.properties;

		const rms = computeRms(chunk.samples);
		const targetGainDb = computeTargetGain(rms, target, maxGain, maxCut);

		if (targetGainDb !== undefined) {
			const alpha = 1 - Math.exp(-1 / (speed * (this.windowSamples / this.windowSeconds)));

			this.currentGainDb += alpha * (targetGainDb - this.currentGainDb);
		}

		const gainLinear = Math.pow(10, this.currentGainDb / 20);

		const samples = chunk.samples.map((channel) => {
			const output = new Float32Array(channel.length);

			for (let index = 0; index < channel.length; index++) {
				output[index] = (channel[index] ?? 0) * gainLinear;
			}

			return output;
		});

		return { samples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class LevelerNode extends TransformNode<LevelerProperties> {
	static override readonly moduleName = "Leveler";
	static override readonly packageName = "buffered-audio-nodes";
	static override readonly moduleDescription = "Smooth volume variations for consistent loudness";
	static override readonly schema = schema;
	static override is(value: unknown): value is LevelerNode {
		return TransformNode.is(value) && value.type[2] === "leveler";
	}

	override readonly type = ["buffered-audio-node", "transform", "leveler"] as const;

	override createStream(): LevelerStream {
		return new LevelerStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<LevelerProperties>): LevelerNode {
		return new LevelerNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function leveler(options?: { target?: number; window?: number; speed?: number; maxGain?: number; maxCut?: number; id?: string }): LevelerNode {
	return new LevelerNode({
		target: options?.target ?? -20,
		window: options?.window ?? 0.5,
		speed: options?.speed ?? 0.1,
		maxGain: options?.maxGain ?? 12,
		maxCut: options?.maxCut ?? 12,
		id: options?.id,
	});
}
