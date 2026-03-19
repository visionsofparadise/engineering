import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { StreamContext } from "../../node";
import { waitForDrain } from "../../utils/ffmpeg";
import { deinterleaveBuffer, interleave } from "../../utils/interleave";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	args: z.array(z.string()).default([]),
});

export interface FfmpegProperties extends TransformNodeProperties {
	readonly ffmpegPath: string;
	readonly args?: Array<string> | ((context: StreamContext) => Array<string>);
}

export class FfmpegStream<P extends FfmpegProperties = FfmpegProperties> extends BufferedTransformStream<P> {
	protected _buildArgs(_context: StreamContext): Array<string> {
		const props = this.properties;
		const { args } = props;
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
		const props = this.properties;
		this._ffmpegChannels = buffer.channels;
		const sr = this.sampleRate ?? 44100;
		const channels = buffer.channels;
		const inputArgs = ["-f", "f32le", "-ar", String(sr), "-ac", String(channels), "-i", "pipe:0"];
		const filterArgs = this._buildArgs(this.context);
		const outputArgs = this._buildOutputArgs(this.context);

		const result = await runFfmpeg(props.ffmpegPath, [...inputArgs, ...filterArgs, ...outputArgs], buffer, channels);

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

	override readonly type: ReadonlyArray<string> = ["async-module", "transform", "ffmpeg"];
	override readonly bufferSize = WHOLE_FILE;
	override readonly latency = WHOLE_FILE;

	override createStream(context: StreamContext): FfmpegStream<P> {
		return new FfmpegStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
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

function runFfmpeg(binaryPath: string, args: Array<string>, buffer: ChunkBuffer, channels: number): Promise<Array<Float32Array>> {
	return new Promise<Array<Float32Array>>((resolve, reject) => {
		const proc: ChildProcess = spawn(binaryPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (!proc.stdout || !proc.stderr || !proc.stdin) {
			reject(new Error("Failed to create ffmpeg stdio streams"));
			return;
		}

		const stdout = proc.stdout;
		const stderr = proc.stderr;
		const stdin = proc.stdin;

		const outputChunks: Array<Buffer> = [];
		const stderrChunks: Array<Buffer> = [];

		stdout.on("data", (chunk: Buffer) => {
			outputChunks.push(chunk);
		});

		stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				const stderrOutput = Buffer.concat(stderrChunks).toString();
				reject(new Error(`ffmpeg exited with code ${code}: ${stderrOutput}`));
				return;
			}

			const outputBuffer = Buffer.concat(outputChunks);
			const samples = deinterleaveBuffer(outputBuffer, channels);
			resolve(samples);
		});

		stdin.on("error", () => {
			// Ignore EPIPE/EOF — expected when filters like trim close stdin early
		});

		void writeBufferToStdin(proc, stdin, buffer).catch(() => {
			// Ignore write errors — ffmpeg may close stdin before all data is written
		});
	});
}

async function writeBufferToStdin(proc: ChildProcess, stdin: NodeJS.WritableStream, buffer: ChunkBuffer): Promise<void> {
	const chunkSize = 44100;

	for await (const chunk of buffer.iterate(chunkSize)) {
		const interleaved = interleave(chunk.samples, chunk.samples[0]?.length ?? 0, chunk.samples.length);
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		const canWrite = stdin.write(buf);

		if (!canWrite) {
			await waitForDrain(proc, stdin);
		}
	}

	stdin.end();
}
