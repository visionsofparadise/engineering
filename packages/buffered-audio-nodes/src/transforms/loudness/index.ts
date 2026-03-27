import { z } from "zod";
import type { ChunkBuffer, StreamContext } from "buffered-audio-nodes-core";
import { FfmpegNode, FfmpegStream, type FfmpegProperties } from "../ffmpeg";
import { measureLoudness } from "./utils/measurement";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	target: z.number().min(-50).max(0).multipleOf(0.1).default(-14).describe("Target"),
	truePeak: z.number().min(-10).max(0).multipleOf(0.1).default(-1).describe("True Peak"),
	lra: z.number().min(0).max(20).multipleOf(0.1).default(0).describe("LRA"),
});

export interface LoudnessProperties extends FfmpegProperties {
	readonly target: number;
	readonly truePeak: number;
	readonly lra?: number;
}

export class LoudnessStream extends FfmpegStream<LoudnessProperties> {
	private measuredValues?: {
		inputI: string;
		inputTp: string;
		inputLra: string;
		inputThresh: string;
		targetOffset: string;
	};

	protected override _buildArgs(_context: StreamContext): Array<string> {
		return this.buildArgsWithMeasurement();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const sr = this.sampleRate ?? 44100;
		const ch = buffer.channels;

		this.measuredValues = await measureLoudness(buffer, sr, ch, this.properties);

		await super._process(buffer);

		this.measuredValues = undefined;
	}

	private buildArgsWithMeasurement(): Array<string> {
		const { target, truePeak, lra } = this.properties;

		if (this.measuredValues) {
			const { inputI, inputTp, inputLra, inputThresh, targetOffset } = this.measuredValues;
			const parts = [
				`I=${target}`,
				`TP=${truePeak}`,
				lra !== undefined ? `LRA=${lra}` : "",
				`measured_I=${inputI}`,
				`measured_TP=${inputTp}`,
				`measured_LRA=${inputLra}`,
				`measured_thresh=${inputThresh}`,
				`offset=${targetOffset}`,
				"linear=true",
			].filter(Boolean);

			return ["-af", `loudnorm=${parts.join(":")}`];
		}

		const parts = [`I=${target}`, `TP=${truePeak}`, lra !== undefined ? `LRA=${lra}` : ""].filter(Boolean);

		return ["-af", `loudnorm=${parts.join(":")}`];
	}
}

export class LoudnessNode extends FfmpegNode<LoudnessProperties> {
	static override readonly moduleName = "Loudness";
	static override readonly moduleDescription = "Measure integrated, short-term, and momentary loudness";
	static override readonly schema = schema;
	static override is(value: unknown): value is LoudnessNode {
		return FfmpegNode.is(value) && value.type[3] === "loudness";
	}

	override readonly type = ["buffered-audio-node", "transform", "ffmpeg", "loudness"] as const;

	override createStream(): LoudnessStream {
		return new LoudnessStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<LoudnessProperties>): LoudnessNode {
		return new LoudnessNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function loudness(ffmpegPath: string, options?: { target?: number; truePeak?: number; lra?: number; id?: string }): LoudnessNode {
	return new LoudnessNode({
		ffmpegPath,
		target: options?.target ?? -14,
		truePeak: options?.truePeak ?? -1,
		lra: options?.lra,
		id: options?.id,
	});
}
