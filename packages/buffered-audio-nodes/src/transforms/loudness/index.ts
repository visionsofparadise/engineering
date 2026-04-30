import { z } from "zod";
import type { ChunkBuffer, StreamContext } from "@e9g/buffered-audio-nodes-core";
import { FfmpegNode, FfmpegStream, type FfmpegProperties } from "../ffmpeg";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { measureLoudness } from "./utils/measurement";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	target: z.number().min(-50).max(0).multipleOf(0.1).default(-14).describe("Target integrated loudness (LUFS)"),
	truePeak: z.number().min(-10).max(0).multipleOf(0.1).default(-1).describe("True peak ceiling (dBTP) — enforced by limiter, not by clamping the loudness gain"),
});

export interface LoudnessProperties extends FfmpegProperties {
	readonly target: number;
	readonly truePeak: number;
}

export class LoudnessStream extends FfmpegStream<LoudnessProperties> {
	private measuredValues?: {
		inputI: string;
		inputTp: string;
		inputLra: string;
		inputThresh: string;
		targetOffset: string;
	};
	private sampleRateForApply?: number;

	protected override _buildArgs(_context: StreamContext): Array<string> {
		return this.buildArgsWithMeasurement();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const sr = this.sampleRate ?? 44100;
		const ch = buffer.channels;

		this.measuredValues = await measureLoudness(buffer, sr, ch, this.properties);
		this.sampleRateForApply = sr;

		await super._process(buffer);

		this.measuredValues = undefined;
		this.sampleRateForApply = undefined;
	}

	private buildArgsWithMeasurement(): Array<string> {
		const { target, truePeak } = this.properties;

		if (!this.measuredValues || this.sampleRateForApply === undefined) {
			// Defensive — _process always sets these before super._process triggers _buildArgs.
			return ["-af", "anull"];
		}

		const { inputI } = this.measuredValues;
		const gainDb = target - Number.parseFloat(inputI);
		const limitLinear = 10 ** (truePeak / 20);
		const sr = this.sampleRateForApply;
		const upsampleRate = sr * 4;

		// Loudness normalization apply pipeline:
		//   1. volume     — pure linear gain shift to land integrated loudness at target.
		//                   No TP clamping in the gain stage; the loudness target is binding.
		//   2. aresample  — upsample 4x via soxr so inter-sample peaks become sample peaks.
		//   3. alimiter   — sample-peak limiter at the upsampled rate (= true-peak limiter at
		//                   the original rate). level=disabled prevents the filter's
		//                   auto-renormalization from undoing the limiting; latency=true
		//                   compensates lookahead delay so output is time-aligned.
		//   4. aresample  — downsample back; the limited (oversampled) peaks survive the
		//                   filter math because they're below the linear ceiling.
		//
		// TODO: alimiter is a settling. Resurrect the deleted Oversampler + DynamicsStream
		// (see commit a56ddf9^) and embed a native true-peak-aware limiter inside this
		// node — proper lookahead, knee, stereo-link control. Tracked at:
		//   D:\Documents\Planner\projects\code\engineering\buffered-audio-nodes\design-loudness-limiter.md
		const filterChain = [
			`volume=${gainDb}dB`,
			`aresample=${upsampleRate}:resampler=soxr`,
			`alimiter=limit=${limitLinear}:level=disabled:latency=true`,
			`aresample=${sr}:resampler=soxr`,
		].join(",");

		return ["-af", filterChain];
	}
}

export class LoudnessNode extends FfmpegNode<LoudnessProperties> {
	static override readonly moduleName = "Loudness";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
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

export function loudness(ffmpegPath: string, options?: { target?: number; truePeak?: number; id?: string }): LoudnessNode {
	return new LoudnessNode({
		ffmpegPath,
		target: options?.target ?? -14,
		truePeak: options?.truePeak ?? -1,
		id: options?.id,
	});
}
