import { z } from "zod";
import type { StreamContext } from "../../module";
import { FfmpegModule, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	rate: z.number().min(0.25).max(4).multipleOf(0.01).default(1).describe("Rate"),
});

export interface TimeStretchProperties extends FfmpegProperties {
	readonly rate: number;
}

export class TimeStretchModule extends FfmpegModule<TimeStretchProperties> {
	static override readonly moduleName = "Time Stretch";
	static override readonly moduleDescription = "Change duration without affecting pitch";
	static override readonly schema = schema;
	static override is(value: unknown): value is TimeStretchModule {
		return FfmpegModule.is(value) && value.type[3] === "time-stretch";
	}

	override readonly type = ["async-module", "transform", "ffmpeg", "time-stretch"] as const;

	protected override _buildArgs(_context: StreamContext): Array<string> {
		const filters = buildAtempoChain(this.properties.rate);
		return ["-af", filters.join(",")];
	}

	override clone(overrides?: Partial<TimeStretchProperties>): TimeStretchModule {
		return new TimeStretchModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function buildAtempoChain(rate: number): Array<string> {
	const filters: Array<string> = [];
	let remaining = rate;

	while (remaining > 2.0) {
		filters.push("atempo=2.0");
		remaining /= 2.0;
	}

	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}

	filters.push(`atempo=${remaining}`);

	return filters;
}

export function timeStretch(
	ffmpegPath: string,
	rate: number,
	options?: {
		id?: string;
	},
): TimeStretchModule {
	return new TimeStretchModule({
		ffmpegPath,
		rate,
		id: options?.id,
	});
}
