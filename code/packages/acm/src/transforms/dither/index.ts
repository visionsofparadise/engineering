import type { AudioChainModuleInput, AudioChunk } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export interface DitherProperties extends TransformModuleProperties {
	readonly bitDepth: 16 | 24;
	readonly noiseShaping?: boolean;
}

export class DitherModule extends TransformModule {
	static override is(value: unknown): value is DitherModule {
		return TransformModule.is(value) && value.type[2] === "dither";
	}

	readonly type = ["async-module", "transform", "dither"] as const;
	readonly properties: DitherProperties;
	readonly bufferSize = 0;
	readonly latency = 0;

	private lastError = 0;

	constructor(properties: AudioChainModuleInput<DitherProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { bitDepth, noiseShaping } = this.properties;
		const quantizationLevels = Math.pow(2, bitDepth - 1);
		const lsb = 1 / quantizationLevels;

		const samples = chunk.samples.map((channel) => {
			const output = new Float32Array(channel.length);

			for (let index = 0; index < channel.length; index++) {
				const sample = channel[index] ?? 0;
				const tpdfNoise = (Math.random() - Math.random()) * lsb;

				let dithered = sample + tpdfNoise;

				if (noiseShaping) {
					dithered += this.lastError;
				}

				const quantized = Math.round(dithered * quantizationLevels) / quantizationLevels;

				if (noiseShaping) {
					this.lastError = dithered - quantized;
				}

				output[index] = quantized;
			}

			return output;
		});

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}

	clone(overrides?: Partial<DitherProperties>): DitherModule {
		return new DitherModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function dither(
	bitDepth: 16 | 24,
	options?: {
		noiseShaping?: boolean;
		id?: string;
	},
): DitherModule {
	return new DitherModule({
		bitDepth,
		noiseShaping: options?.noiseShaping,
		id: options?.id,
	});
}
