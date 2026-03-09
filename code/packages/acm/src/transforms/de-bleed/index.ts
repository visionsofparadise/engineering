import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { readToBuffer } from "../../utils/read-to-buffer";

export interface DeBleedProperties extends TransformModuleProperties {
	readonly referencePath: string;
	readonly filterLength: number;
	readonly stepSize: number;
}

export class DeBleedModule extends TransformModule {
	static override is(value: unknown): value is DeBleedModule {
		return TransformModule.is(value) && value.type[2] === "de-bleed";
	}

	readonly type = ["async-module", "transform", "de-bleed"] as const;
	readonly properties: DeBleedProperties;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private referenceSignal?: Float32Array;

	constructor(properties: AudioChainModuleInput<DeBleedProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

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

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			const output = new Float32Array(frames);
			const filterCoeffs = new Float32Array(filterLength);

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
