import { z } from "zod";
import type { AudioChunk } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	invert: z.boolean().default(true).describe("Invert"),
	angle: z.number().min(-180).max(180).multipleOf(1).default(0).describe("Angle"),
});

export interface PhaseProperties extends TransformModuleProperties {
	readonly invert: boolean;
	readonly angle?: number;
}

export class PhaseModule extends TransformModule<PhaseProperties> {
	static override readonly moduleName = "Phase";
	static override readonly schema = schema;
	static override is(value: unknown): value is PhaseModule {
		return TransformModule.is(value) && value.type[2] === "phase";
	}

	override readonly type = ["async-module", "transform", "phase"] as const;

	override readonly bufferSize = 0;
	override readonly latency = 0;

	private allpassState: Array<number> = [];

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { invert, angle } = this.properties;

		if (angle !== undefined) {
			return this.applyPhaseRotation(chunk, angle);
		}

		if (invert) {
			return this.applyInvert(chunk);
		}

		return chunk;
	}

	private applyInvert(chunk: AudioChunk): AudioChunk {
		const samples = chunk.samples.map((channel) => {
			const output = new Float32Array(channel.length);

			for (let index = 0; index < channel.length; index++) {
				output[index] = -(channel[index] ?? 0);
			}

			return output;
		});

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}

	private applyPhaseRotation(chunk: AudioChunk, angle: number): AudioChunk {
		const radians = (angle * Math.PI) / 180;
		const coefficient = Math.tan((radians - Math.PI) / 4);

		while (this.allpassState.length < chunk.samples.length) {
			this.allpassState.push(0);
		}

		const samples = chunk.samples.map((channel, ch) => {
			const output = new Float32Array(channel.length);
			let state = this.allpassState[ch] ?? 0;

			for (let index = 0; index < channel.length; index++) {
				const input = channel[index] ?? 0;
				const allpassOut = coefficient * input + state;
				state = input - coefficient * allpassOut;
				output[index] = allpassOut;
			}

			this.allpassState[ch] = state;

			return output;
		});

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}

	clone(overrides?: Partial<PhaseProperties>): PhaseModule {
		return new PhaseModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function phase(options?: { invert?: boolean; angle?: number; id?: string }): PhaseModule {
	return new PhaseModule({
		invert: options?.invert ?? true,
		angle: options?.angle,
		id: options?.id,
	});
}

export function invert(options?: { id?: string }): PhaseModule {
	return phase({ invert: true, id: options?.id });
}
