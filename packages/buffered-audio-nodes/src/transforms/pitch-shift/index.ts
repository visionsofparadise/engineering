import { z } from "zod";
import type { StreamContext } from "buffered-audio-nodes-core";
import { FfmpegNode, FfmpegStream, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	semitones: z.number().min(-24).max(24).multipleOf(1).default(0).describe("Semitones"),
	cents: z.number().min(-100).max(100).multipleOf(1).default(0).describe("Cents"),
});

export interface PitchShiftProperties extends FfmpegProperties {
	readonly semitones: number;
	readonly cents?: number;
}

export class PitchShiftStream extends FfmpegStream<PitchShiftProperties> {
	protected override _buildArgs(_context: StreamContext): Array<string> {
		const { semitones, cents } = this.properties;
		const totalSemitones = semitones + (cents ?? 0) / 100;
		const pitchRatio = Math.pow(2, totalSemitones / 12);

		return ["-af", `rubberband=pitch=${pitchRatio}`];
	}
}

export class PitchShiftNode extends FfmpegNode<PitchShiftProperties> {
	static override readonly moduleName = "Pitch Shift";
	static override readonly packageName = "buffered-audio-nodes";
	static override readonly moduleDescription = "Change pitch without affecting duration";
	static override readonly schema = schema;
	static override is(value: unknown): value is PitchShiftNode {
		return FfmpegNode.is(value) && value.type[3] === "pitch-shift";
	}

	override readonly type = ["buffered-audio-node", "transform", "ffmpeg", "pitch-shift"] as const;

	override createStream(): PitchShiftStream {
		return new PitchShiftStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<PitchShiftProperties>): PitchShiftNode {
		return new PitchShiftNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function pitchShift(
	ffmpegPath: string,
	semitones: number,
	options?: {
		cents?: number;
		id?: string;
	},
): PitchShiftNode {
	return new PitchShiftNode({
		ffmpegPath,
		semitones,
		cents: options?.cents,
		id: options?.id,
	});
}
