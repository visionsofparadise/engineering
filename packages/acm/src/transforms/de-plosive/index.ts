import { z } from "zod";
import type { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	frequency: z.number().min(50).max(500).multipleOf(10).default(200).describe("Frequency"),
});

export interface DePlosiveProperties extends z.infer<typeof schema>, TransformModuleProperties {}

export class DePlosiveModule extends TransformModule<DePlosiveProperties> {
	static override readonly moduleName = "De-Plosive";
	static override readonly moduleDescription = "Reduce plosive bursts (p, b, t, d sounds)";
	static override readonly schema = schema;
	static override is(value: unknown): value is DePlosiveModule {
		return TransformModule.is(value) && value.type[2] === "de-plosive";
	}

	override readonly type = ["async-module", "transform", "de-plosive"] as const;
	override readonly latency = 0;

	private sampleRate = 44100;
	private lpState: Array<number> = [];

	override get bufferSize(): number {
		return Math.round(this.sampleRate * 0.02);
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.sampleRate = context.sampleRate;
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { sensitivity, frequency } = this.properties;
		const cutoffCoeff = Math.exp((-2 * Math.PI * frequency) / this.sampleRate);
		const threshold = 0.1 * (1 - sensitivity);

		while (this.lpState.length < chunk.samples.length) {
			this.lpState.push(0);
		}

		const samples = chunk.samples.map((channel, ch) => {
			const output = new Float32Array(channel.length);
			let lpVal = this.lpState[ch] ?? 0;

			let lowEnergy = 0;
			let totalEnergy = 0;

			for (const sample of channel) {
				lpVal = lpVal * cutoffCoeff + sample * (1 - cutoffCoeff);
				lowEnergy += lpVal * lpVal;
				totalEnergy += sample * sample;
			}

			this.lpState[ch] = lpVal;

			const lowRatio = totalEnergy > 0 ? lowEnergy / totalEnergy : 0;
			const isPlosive = lowRatio > 0.5 && Math.sqrt(lowEnergy / channel.length) > threshold;

			if (isPlosive) {
				const fadeLength = Math.min(channel.length, Math.round(this.sampleRate * 0.005));

				for (let index = 0; index < channel.length; index++) {
					const sample = channel[index] ?? 0;
					const filtered = sample - (lpVal * cutoffCoeff + sample * (1 - cutoffCoeff)) * 0.8;

					let fade = 1;

					if (index < fadeLength) {
						fade = index / fadeLength;
					} else if (index > channel.length - fadeLength) {
						fade = (channel.length - index) / fadeLength;
					}

					output[index] = sample * (1 - fade) + filtered * fade;
				}
			} else {
				output.set(channel);
			}

			return output;
		});

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}

	clone(overrides?: Partial<DePlosiveProperties>): DePlosiveModule {
		return new DePlosiveModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function dePlosive(options?: { sensitivity?: number; frequency?: number; id?: string }): DePlosiveModule {
	return new DePlosiveModule({
		sensitivity: options?.sensitivity ?? 0.5,
		frequency: options?.frequency ?? 200,
		id: options?.id,
	});
}
