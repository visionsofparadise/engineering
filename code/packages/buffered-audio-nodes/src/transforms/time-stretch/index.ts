import { z } from "zod";
import type { StreamContext } from "../../node";
import { FfmpegNode, FfmpegStream, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	rate: z.number().min(0.25).max(4).multipleOf(0.01).default(1).describe("Rate"),
});

export interface TimeStretchProperties extends FfmpegProperties {
	readonly rate: number;
}

export class TimeStretchStream extends FfmpegStream<TimeStretchProperties> {
	protected override _buildArgs(_context: StreamContext): Array<string> {
		const props = this.properties;
		const filters = buildAtempoChain(props.rate);
		return ["-af", filters.join(",")];
	}
}

export class TimeStretchNode extends FfmpegNode<TimeStretchProperties> {
	static override readonly moduleName = "Time Stretch";
	static override readonly moduleDescription = "Change duration without affecting pitch";
	static override readonly schema = schema;
	static override is(value: unknown): value is TimeStretchNode {
		return FfmpegNode.is(value) && value.type[3] === "time-stretch";
	}

	override readonly type = ["async-module", "transform", "ffmpeg", "time-stretch"] as const;

	override createStream(context: StreamContext): TimeStretchStream {
		return new TimeStretchStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<TimeStretchProperties>): TimeStretchNode {
		return new TimeStretchNode({ ...this.properties, previousProperties: this.properties, ...overrides });
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
): TimeStretchNode {
	return new TimeStretchNode({
		ffmpegPath,
		rate,
		id: options?.id,
	});
}
