import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk, StreamContext } from "../../node";
import { BufferedTransformStream, TransformNode, type TransformNodeProperties } from "../../transform";

export const schema = z.object({
	target: z.number().min(-60).max(0).multipleOf(1).default(-20).describe("Target"),
	window: z.number().min(0.01).max(5).multipleOf(0.01).default(0.5).describe("Window"),
	speed: z.number().min(0.01).max(1).multipleOf(0.01).default(0.1).describe("Speed"),
	maxGain: z.number().min(0).max(40).multipleOf(1).default(12).describe("Max Gain"),
	maxCut: z.number().min(0).max(40).multipleOf(1).default(12).describe("Max Cut"),
});

export interface LevelerProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class LevelerStream extends BufferedTransformStream<LevelerProperties> {
	private windowSamples: number;
	private currentGainDb = 0;
	private windowSeconds: number;

	constructor(properties: LevelerProperties, context: StreamContext) {
		super(properties, context);
		this.windowSeconds = this.properties.window;
		this.windowSamples = Math.round(this.properties.window * context.sampleRate);
	}

	override _process(_buffer: ChunkBuffer): void {
		// Processing happens in _unbuffer
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { target, speed, maxGain, maxCut } = this.properties;

		let rms = 0;
		let sampleCount = 0;

		for (const channel of chunk.samples) {
			for (const sample of channel) {
				rms += sample * sample;
				sampleCount++;
			}
		}

		rms = sampleCount > 0 ? Math.sqrt(rms / sampleCount) : 0;

		const rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));

		const GATE_THRESHOLD_DB = -60;

		if (rmsDb > GATE_THRESHOLD_DB) {
			let targetGainDb = target - rmsDb;
			targetGainDb = Math.max(-maxCut, Math.min(maxGain, targetGainDb));

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

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}
}

export class LevelerNode extends TransformNode<LevelerProperties> {
	static override readonly moduleName = "Leveler";
	static override readonly moduleDescription = "Smooth volume variations for consistent loudness";
	static override readonly schema = schema;
	static override is(value: unknown): value is LevelerNode {
		return TransformNode.is(value) && value.type[2] === "leveler";
	}

	override readonly type = ["async-module", "transform", "leveler"] as const;
	override readonly latency = 0;

	private windowSamples = 22050;

	override get bufferSize(): number {
		return this.windowSamples;
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.windowSamples = Math.round(this.properties.window * context.sampleRate);
	}

	protected override createStream(context: StreamContext): LevelerStream {
		return new LevelerStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
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
