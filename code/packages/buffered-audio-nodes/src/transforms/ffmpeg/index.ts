import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { StreamContext } from "../../node";
import { runFfmpeg } from "./utils/process";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	args: z.array(z.string()).default([]),
});

export interface FfmpegProperties extends TransformNodeProperties {
	readonly ffmpegPath: string;
	readonly args?: Array<string> | ((context: StreamContext) => Array<string>);
}

export class FfmpegStream<P extends FfmpegProperties = FfmpegProperties> extends BufferedTransformStream<P> {
	private streamContext?: StreamContext;

	override _setup(context: StreamContext): void {
		this.streamContext = context;
	}

	protected _buildArgs(_context: StreamContext): Array<string> {
		const { args } = this.properties;

		if (!args) return [];

		return typeof args === "function" ? args(_context) : args;
	}

	protected _buildOutputArgs(_context: StreamContext): Array<string> {
		return ["-f", "f32le", "-ar", String(this.sampleRate ?? 44100), "-ac", String(this.ffmpegChannels), "pipe:1"];
	}

	protected get ffmpegChannels(): number {
		return this._ffmpegChannels;
	}

	private _ffmpegChannels = 1;

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.streamContext) throw new Error("FfmpegStream._process called before setup()");

		this._ffmpegChannels = buffer.channels;
		const sr = this.sampleRate ?? 44100;
		const channels = buffer.channels;
		const inputArgs = ["-f", "f32le", "-ar", String(sr), "-ac", String(channels), "-i", "pipe:0"];
		const filterArgs = this._buildArgs(this.streamContext);
		const outputArgs = this._buildOutputArgs(this.streamContext);

		const result = await runFfmpeg(this.properties.ffmpegPath, [...inputArgs, ...filterArgs, ...outputArgs], buffer, channels);

		await buffer.truncate(0);

		const frames = result[0]?.length ?? 0;

		if (frames > 0) {
			await buffer.append(result);
		}
	}
}

export class FfmpegNode<P extends FfmpegProperties = FfmpegProperties> extends TransformNode<P> {
	static override readonly moduleName: string = "FFmpeg";
	static override readonly moduleDescription: string = "Process audio through FFmpeg filters";
	static override readonly schema: z.ZodType = schema;
	static override is(value: unknown): value is FfmpegNode {
		return TransformNode.is(value) && value.type[2] === "ffmpeg";
	}

	override readonly type: ReadonlyArray<string> = ["buffered-audio-node", "transform", "ffmpeg"];

	constructor(properties: P) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): FfmpegStream<P> {
		return new FfmpegStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<P>): FfmpegNode<P> {
		return new FfmpegNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function ffmpeg(options: { ffmpegPath: string; args: Array<string> | ((context: StreamContext) => Array<string>); id?: string }): FfmpegNode {
	return new FfmpegNode({
		ffmpegPath: options.ffmpegPath,
		args: options.args,
		id: options.id,
	});
}

