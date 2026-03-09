import { spawn, type ChildProcess } from "node:child_process";
import type { ChunkBuffer } from "./chunk-buffer";
import type { StreamContext } from "./module";
import { TransformModule, type TransformModuleProperties } from "./transform";
import { resolveBinary } from "./utils/resolve-binary";

export interface FfmpegProperties extends TransformModuleProperties {
	readonly binaryPath?: string;
}

export abstract class FfmpegModule extends TransformModule {
	static override is(value: unknown): value is FfmpegModule {
		return TransformModule.is(value) && value.type[2] === "ffmpeg";
	}

	declare readonly properties: FfmpegProperties;

	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private resolvedBinaryPath?: string;
	private ffmpegContext?: StreamContext;

	protected abstract _buildArgs(context: StreamContext): Array<string>;

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.ffmpegContext = context;
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.resolvedBinaryPath = await resolveBinary("ffmpeg", this.properties.binaryPath);
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
