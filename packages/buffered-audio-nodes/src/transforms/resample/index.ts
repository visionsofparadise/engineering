import { z } from "zod";
import type { ChunkBuffer, StreamContext } from "buffered-audio-nodes-core";
import { FfmpegNode, FfmpegStream, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	sampleRate: z.number().min(8000).max(192000).multipleOf(100).default(44100).describe("Sample Rate"),
	dither: z.enum(["triangular", "lipshitz", "none"]).default("triangular").describe("Dither"),
});

export interface ResampleProperties extends FfmpegProperties {
	readonly sampleRate: number;
	readonly dither?: "triangular" | "lipshitz" | "none";
}

export class ResampleStream extends FfmpegStream<ResampleProperties> {
	override async _process(buffer: ChunkBuffer): Promise<void> {
		await super._process(buffer);
		buffer.setSampleRate(this.properties.sampleRate);
	}

	protected override _buildArgs(_context: StreamContext): Array<string> {
		const { sampleRate, dither } = this.properties;
		const ditherMethod = dither ?? "triangular";

		return ["-af", `aresample=${sampleRate}:resampler=soxr:dither_method=${ditherMethod}`];
	}

	protected override _buildOutputArgs(_context: StreamContext): Array<string> {
		return ["-f", "f32le", "-ar", String(this.properties.sampleRate), "-ac", String(this.ffmpegChannels), "pipe:1"];
	}
}

export class ResampleNode extends FfmpegNode<ResampleProperties> {
	static override readonly moduleName = "Resample";
	static override readonly moduleDescription = "Change sample rate";
	static override readonly schema = schema;

	static override is(value: unknown): value is ResampleNode {
		return FfmpegNode.is(value) && value.type[3] === "resample";
	}

	override readonly type = ["buffered-audio-node", "transform", "ffmpeg", "resample"] as const;

	override createStream(): ResampleStream {
		return new ResampleStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<ResampleProperties>): ResampleNode {
		return new ResampleNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function resample(
	ffmpegPath: string,
	sampleRate: number,
	options?: {
		dither?: "triangular" | "lipshitz" | "none";
		id?: string;
	},
): ResampleNode {
	return new ResampleNode({
		ffmpegPath,
		sampleRate,
		dither: options?.dither,
		id: options?.id,
	});
}
