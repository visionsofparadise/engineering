import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg" }).describe("FFmpeg Path"),
	args: z.array(z.string()).default([]),
});

export interface FfmpegProperties extends TransformModuleProperties {
	readonly ffmpegPath: string;
	readonly args?: Array<string> | ((context: StreamContext) => Array<string>);
}

export class FfmpegModule<P extends FfmpegProperties = FfmpegProperties> extends TransformModule<P> {
	static override readonly moduleName: string = "FFmpeg";
	static override readonly moduleDescription: string = "Process audio through FFmpeg filters";
	static override readonly schema: z.ZodType = schema;
	static override is(value: unknown): value is FfmpegModule {
		return TransformModule.is(value) && value.type[2] === "ffmpeg";
	}

	override readonly type: ReadonlyArray<string> = ["async-module", "transform", "ffmpeg"];
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private resolvedBinaryPath?: string;
	private ffmpegContext?: StreamContext;

	protected _buildArgs(context: StreamContext): Array<string> {
		const { args } = this.properties;
		if (!args) return [];
		return typeof args === "function" ? args(context) : args;
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.ffmpegContext = context;
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.resolvedBinaryPath = this.properties.ffmpegPath;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.resolvedBinaryPath || !this.ffmpegContext) {
			throw new Error("FfmpegTransformModule not set up");
		}

		const context = this.ffmpegContext;
		const inputArgs = buildInputArgs(context);
		const filterArgs = this._buildArgs(context);
		const outputArgs = buildOutputArgs(context);

		const result = await runFfmpeg(this.resolvedBinaryPath, [...inputArgs, ...filterArgs, ...outputArgs], buffer, context);

		await buffer.truncate(0);

		const frames = result[0]?.length ?? 0;

		if (frames > 0) {
			await buffer.append(result);
		}
	}

	protected getStreamContext(): StreamContext {
		if (!this.ffmpegContext) throw new Error("FfmpegTransformModule not set up");
		return this.ffmpegContext;
	}

	clone(overrides?: Partial<P>): FfmpegModule<P> {
		return new FfmpegModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function ffmpeg(options: { ffmpegPath: string; args: Array<string> | ((context: StreamContext) => Array<string>); id?: string }): FfmpegModule {
	return new FfmpegModule({
		ffmpegPath: options.ffmpegPath,
		args: options.args,
		id: options.id,
	});
}

function buildInputArgs(context: StreamContext): Array<string> {
	return ["-f", "f32le", "-ar", String(context.sampleRate), "-ac", String(context.channels), "-i", "pipe:0"];
}

function buildOutputArgs(context: StreamContext): Array<string> {
	return ["-f", "f32le", "-ar", String(context.sampleRate), "-ac", String(context.channels), "pipe:1"];
}

function runFfmpeg(binaryPath: string, args: Array<string>, buffer: ChunkBuffer, context: StreamContext): Promise<Array<Float32Array>> {
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
			const samples = deinterleave(outputBuffer, context.channels);
			resolve(samples);
		});

		stdin.on("error", () => {
			// Ignore EPIPE/EOF — expected when filters like trim close stdin early
		});

		void writeBufferToStdin(stdin, buffer, context).catch(() => {
			// Ignore write errors — ffmpeg may close stdin before all data is written
		});
	});
}

async function writeBufferToStdin(stdin: NodeJS.WritableStream, buffer: ChunkBuffer, _context: StreamContext): Promise<void> {
	const chunkSize = 44100;

	for await (const chunk of buffer.iterate(chunkSize)) {
		const interleaved = interleave(chunk.samples, chunk.duration, chunk.samples.length);
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		const canWrite = stdin.write(buf);

		if (!canWrite) {
			await new Promise<void>((resolve) => {
				stdin.once("drain", resolve);
			});
		}
	}

	stdin.end();
}

function interleave(samples: Array<Float32Array>, frames: number, channels: number): Float32Array {
	const interleaved = new Float32Array(frames * channels);

	for (let frame = 0; frame < frames; frame++) {
		for (let ch = 0; ch < channels; ch++) {
			interleaved[frame * channels + ch] = samples[ch]?.[frame] ?? 0;
		}
	}

	return interleaved;
}

function deinterleave(buffer: Buffer, channels: number): Array<Float32Array> {
	const totalSamples = buffer.length / 4;
	const frames = Math.floor(totalSamples / channels);
	const result: Array<Float32Array> = [];

	for (let ch = 0; ch < channels; ch++) {
		result.push(new Float32Array(frames));
	}

	const view = new Float32Array(buffer.buffer, buffer.byteOffset, totalSamples);

	for (let frame = 0; frame < frames; frame++) {
		for (let ch = 0; ch < channels; ch++) {
			const channelArray = result[ch];
			const value = view[frame * channels + ch];

			if (channelArray && value !== undefined) {
				channelArray[frame] = value;
			}
		}
	}

	return result;
}
