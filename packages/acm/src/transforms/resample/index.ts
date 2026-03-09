import { FfmpegModule, type FfmpegProperties } from "../../ffmpeg";
import type { AudioChainModuleInput, StreamContext } from "../../module";

export interface ResampleProperties extends FfmpegProperties {
	readonly sampleRate: number;
	readonly dither?: "triangular" | "lipshitz" | "none";
}

export class ResampleModule extends FfmpegModule {
	static override is(value: unknown): value is ResampleModule {
		return FfmpegModule.is(value) && value.type[3] === "resample";
	}

	readonly type = ["async-module", "transform", "ffmpeg", "resample"] as const;
	readonly properties: ResampleProperties;

	constructor(properties: AudioChainModuleInput<ResampleProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	protected _buildArgs(_context: StreamContext): Array<string> {
		const { sampleRate, dither } = this.properties;
		const ditherMethod = dither ?? "triangular";

		return ["-af", `aresample=${sampleRate}:resampler=soxr:dither_method=${ditherMethod}`];
	}

	clone(overrides?: Partial<ResampleProperties>): ResampleModule {
		return new ResampleModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function resample(
	sampleRate: number,
	options?: {
		dither?: "triangular" | "lipshitz" | "none";
		binaryPath?: string;
		id?: string;
	},
): ResampleModule {
	return new ResampleModule({
		sampleRate,
		dither: options?.dither,
		binaryPath: options?.binaryPath,
		id: options?.id,
	});
}
