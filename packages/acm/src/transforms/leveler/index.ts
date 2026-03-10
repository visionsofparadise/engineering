import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	target: z.number().min(-60).max(0).multipleOf(1).default(-20).describe("Target"),
	window: z.number().min(0.01).max(5).multipleOf(0.01).default(0.5).describe("Window"),
	speed: z.number().min(0.01).max(1).multipleOf(0.01).default(0.1).describe("Speed"),
	maxGain: z.number().min(0).max(40).multipleOf(1).default(12).describe("Max Gain"),
	maxCut: z.number().min(0).max(40).multipleOf(1).default(12).describe("Max Cut"),
});

export interface LevelerProperties extends z.infer<typeof schema>, TransformModuleProperties {}

export class LevelerModule extends TransformModule<LevelerProperties> {
	static override readonly moduleName = "Leveler";
	static override readonly moduleDescription = "Smooth volume variations for consistent loudness";
	static override readonly schema = schema;
	static override is(value: unknown): value is LevelerModule {
		return TransformModule.is(value) && value.type[2] === "leveler";
	}

	override readonly type = ["async-module", "transform", "leveler"] as const;
	override readonly latency = 0;

	private windowSamples = 22050;
	private currentGainDb = 0;

	override get bufferSize(): number {
		return this.windowSamples;
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
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
		let targetGainDb = target - rmsDb;

		targetGainDb = Math.max(-maxCut, Math.min(maxGain, targetGainDb));

		const alpha = 1 - Math.exp(-1 / (speed * (this.windowSamples / this.properties.window)));
		this.currentGainDb += alpha * (targetGainDb - this.currentGainDb);

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

	clone(overrides?: Partial<LevelerProperties>): LevelerModule {
		return new LevelerModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function leveler(options?: { target?: number; window?: number; speed?: number; maxGain?: number; maxCut?: number; id?: string }): LevelerModule {
	return new LevelerModule({
		target: options?.target ?? -20,
		window: options?.window ?? 0.5,
		speed: options?.speed ?? 0.1,
		maxGain: options?.maxGain ?? 12,
		maxCut: options?.maxCut ?? 12,
		id: options?.id,
	});
}
