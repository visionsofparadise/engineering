import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { readToBuffer } from "../../utils/read-to-buffer";

export const schema = z.object({
	referencePath: z.string().default("").describe("Reference Path"),
	filterLength: z.number().min(64).max(8192).multipleOf(64).default(1024).describe("Filter Length"),
	stepSize: z.number().min(0.001).max(1).multipleOf(0.001).default(0.1).describe("Step Size"),
});

export interface DeBleedProperties extends z.infer<typeof schema>, TransformModuleProperties {}

export class DeBleedModule extends TransformModule<DeBleedProperties> {
	static override readonly moduleName = "De-Bleed";
	static override readonly moduleDescription = "Reduce microphone bleed between channels";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeBleedModule {
		return TransformModule.is(value) && value.type[2] === "de-bleed";
	}

	override readonly type = ["async-module", "transform", "de-bleed"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private referenceSignal?: Float32Array;

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);
		await this.loadReference();
	}

	private async loadReference(): Promise<void> {
		const { buffer } = await readToBuffer(this.properties.referencePath);
		const chunk = await buffer.read(0, buffer.frames);
		const channel = chunk.samples[0];

		this.referenceSignal = channel ? Float32Array.from(channel) : new Float32Array(0);
		await buffer.close();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.referenceSignal) return;

		const frames = buffer.frames;
		const channels = buffer.channels;
		const { filterLength, stepSize } = this.properties;
		const reference = this.referenceSignal;

		const output = new Float32Array(frames);
		const filterCoeffs = new Float32Array(filterLength);

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			output.fill(0);
			filterCoeffs.fill(0);

			for (let index = 0; index < frames; index++) {
				let predicted = 0;

				for (let tap = 0; tap < filterLength; tap++) {
					const refIndex = index - tap;

					if (refIndex >= 0 && refIndex < reference.length) {
						predicted += (filterCoeffs[tap] ?? 0) * (reference[refIndex] ?? 0);
					}
				}

				const error = (channel[index] ?? 0) - predicted;
				output[index] = error;

				let refPower = 0;

				for (let tap = 0; tap < filterLength; tap++) {
					const refIndex = index - tap;

					if (refIndex >= 0 && refIndex < reference.length) {
						const refVal = reference[refIndex] ?? 0;
						refPower += refVal * refVal;
					}
				}

				const mu = refPower > 1e-10 ? stepSize / (refPower + 1e-10) : 0;

				for (let tap = 0; tap < filterLength; tap++) {
					const refIndex = index - tap;

					if (refIndex >= 0 && refIndex < reference.length) {
						filterCoeffs[tap] = (filterCoeffs[tap] ?? 0) + mu * error * (reference[refIndex] ?? 0);
					}
				}
			}

			const allChannels: Array<Float32Array> = [];

			for (let writeCh = 0; writeCh < channels; writeCh++) {
				allChannels.push(writeCh === ch ? output : (chunk.samples[writeCh] ?? new Float32Array(frames)));
			}

			await buffer.write(0, allChannels);
		}
	}

	clone(overrides?: Partial<DeBleedProperties>): DeBleedModule {
		return new DeBleedModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deBleed(
	referencePath: string,
	options?: {
		filterLength?: number;
		stepSize?: number;
		id?: string;
	},
): DeBleedModule {
	return new DeBleedModule({
		referencePath,
		filterLength: options?.filterLength ?? 1024,
		stepSize: options?.stepSize ?? 0.1,
		id: options?.id,
	});
}
