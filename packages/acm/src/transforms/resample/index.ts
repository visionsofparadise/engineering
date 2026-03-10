import { z } from "zod";
import type { StreamContext } from "../../module";
import { FfmpegModule, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	sampleRate: z.number().min(8000).max(192000).multipleOf(100).default(44100).describe("Sample Rate"),
	dither: z.enum(["triangular", "lipshitz", "none"]).default("triangular").describe("Dither"),
});

export interface ResampleProperties extends FfmpegProperties {
	readonly sampleRate: number;
	readonly dither?: "triangular" | "lipshitz" | "none";
}

export class ResampleModule extends FfmpegModule<ResampleProperties> {
	static override readonly moduleName = "Resample";
	static override readonly moduleDescription = "Change sample rate";
	static override readonly schema = schema;
	static override is(value: unknown): value is ResampleModule {
		return FfmpegModule.is(value) && value.type[3] === "resample";
	}

	override readonly type = ["async-module", "transform", "ffmpeg", "resample"] as const;

	protected override _buildArgs(_context: StreamContext): Array<string> {
		const { sampleRate, dither } = this.properties;
		const ditherMethod = dither ?? "triangular";

		return ["-af", `aresample=${sampleRate}:resampler=soxr:dither_method=${ditherMethod}`];
	}

	override clone(overrides?: Partial<ResampleProperties>): ResampleModule {
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
