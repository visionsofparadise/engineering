import { open, type FileHandle } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import type { AudioChunk, StreamContext } from "../node";
import { BufferedTargetStream, TargetNode, type TargetNodeProperties } from "../target";
import { waitForDrain } from "../utils/ffmpeg";

export type WavBitDepth = "16" | "24" | "32" | "32f";

export interface EncodingOptions {
	readonly format: "wav" | "flac" | "mp3" | "aac";
	readonly bitrate?: string;
	readonly vbr?: number;
}

export const schema = z.object({
	path: z.string().default("").meta({ input: "file", mode: "save" }),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	bitDepth: z.enum(["16", "24", "32", "32f"]).default("16"),
});

export interface WriteProperties extends TargetNodeProperties {
	readonly path: string;
	readonly ffmpegPath?: string;
	readonly bitDepth: WavBitDepth;
	readonly encoding?: EncodingOptions;
}

const WAV_HEADER_SIZE = 80;
const UINT32_MAX = 0xFFFFFFFF;

export class WriteStream extends BufferedTargetStream<WriteProperties> {
	private fileHandle?: FileHandle;
	private ffmpegProcess?: ChildProcess;
	private ffmpegStdin?: NodeJS.WritableStream;
	private ffmpegDone?: Promise<void>;
	private sampleRate = 44100;
	private channels = 1;
	private bytesWritten = 0;
	private useEncoding = false;
	private headerWritten = false;
	private initialized = false;

	private async lazyInit(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;

		this.sampleRate = this.context.sampleRate;
		this.channels = this.context.channels;
		this.bytesWritten = 0;
		this.headerWritten = false;

		const encoding = this.properties.encoding;

		if (encoding && encoding.format !== "wav" && !this.properties.ffmpegPath) {
			throw new Error(`Encoding to ${encoding.format} requires ffmpegPath`);
		}

		this.useEncoding = encoding !== undefined && encoding.format !== "wav" && !!this.properties.ffmpegPath;

		if (this.useEncoding && encoding) {
			const ffmpegPath = this.properties.ffmpegPath;
			if (!ffmpegPath) throw new Error("ffmpegPath is required for encoding");

			const args = this.buildFfmpegArgs(encoding);

			const proc = spawn(ffmpegPath, args, {
				stdio: ["pipe", "ignore", "pipe"],
			});

			this.ffmpegProcess = proc;
			this.ffmpegStdin = proc.stdin;

			this.ffmpegStdin.on("error", () => {});

			this.ffmpegDone = new Promise<void>((resolve, reject) => {
				proc.on("close", (code) => {
					if (code !== 0) {
						reject(new Error(`ffmpeg exited with code ${code}`));
					} else {
						resolve();
					}
				});

				proc.on("error", (error) => {
					reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
				});
			});
		} else {
			this.fileHandle = await open(this.properties.path, "w");
			const header = buildWavHeader(0, this.sampleRate, this.channels, this.properties.bitDepth);
			await this.fileHandle.write(header, 0, WAV_HEADER_SIZE, 0);
		}
	}

	override async _write(chunk: AudioChunk): Promise<void> {
		await this.lazyInit();

		const bytes = this.convertChunk(chunk);

		if (this.useEncoding && this.ffmpegStdin) {
			if (!this.headerWritten) {
				const header = buildWavHeader(0xFFFFFFFF, this.sampleRate, this.channels, this.properties.bitDepth);
				await this.writeToStdin(header);
				this.headerWritten = true;
			}
			await this.writeToStdin(bytes);
		} else if (this.fileHandle) {
			await this.fileHandle.write(bytes, 0, bytes.length, WAV_HEADER_SIZE + this.bytesWritten);
		}

		this.bytesWritten += bytes.length;
	}

	override async _close(): Promise<void> {
		if (this.useEncoding) {
			if (this.ffmpegStdin) {
				this.ffmpegStdin.end();
			}
			if (this.ffmpegDone) {
				await this.ffmpegDone;
			}
			this.ffmpegProcess = undefined;
			this.ffmpegStdin = undefined;
			this.ffmpegDone = undefined;
		} else if (this.fileHandle) {
			const header = this.bytesWritten > UINT32_MAX
				? buildRf64Header(this.bytesWritten, this.sampleRate, this.channels, this.properties.bitDepth)
				: buildWavHeader(this.bytesWritten, this.sampleRate, this.channels, this.properties.bitDepth);
			await this.fileHandle.write(header, 0, WAV_HEADER_SIZE, 0);
			await this.fileHandle.close();
			this.fileHandle = undefined;
		}
	}

	private convertChunk(chunk: AudioChunk): Buffer {
		const frames = chunk.duration;
		const channels = chunk.samples.length;
		const bytesPerSample = getBytesPerSample(this.properties.bitDepth);
		const buffer = Buffer.alloc(frames * channels * bytesPerSample);

		let offset = 0;

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < channels; ch++) {
				const sample = chunk.samples[ch]?.[frame] ?? 0;
				offset = writeSample(buffer, offset, sample, this.properties.bitDepth);
			}
		}

		return buffer;
	}

	private buildFfmpegArgs(encoding: EncodingOptions): Array<string> {
		const args = ["-f", "wav", "-i", "pipe:0"];

		switch (encoding.format) {
			case "flac":
				args.push("-codec:a", "flac");
				break;
			case "mp3":
				args.push("-codec:a", "libmp3lame");
				if (encoding.vbr !== undefined) {
					args.push("-q:a", String(encoding.vbr));
				} else {
					args.push("-b:a", encoding.bitrate ?? "192k");
				}
				break;
			case "aac":
				args.push("-codec:a", "aac", "-b:a", encoding.bitrate ?? "192k");
				break;
		}

		args.push("-y", this.properties.path);
		return args;
	}

	private writeToStdin(data: Buffer): Promise<void> {
		const stdin = this.ffmpegStdin;
		const proc = this.ffmpegProcess;
		if (!stdin || !proc) return Promise.resolve();

		const canWrite = stdin.write(data);

		if (!canWrite) {
			return waitForDrain(proc, stdin);
		}

		return Promise.resolve();
	}
}

export class WriteNode extends TargetNode<WriteProperties> {
	static override readonly moduleName = "Write";
	static override readonly moduleDescription = "Write audio to a file";
	static override readonly schema = schema;
	override readonly type = ["async-module", "target", "write"] as const;

	readonly bufferSize = 0;
	readonly latency = 0;

	protected override createStream(context: StreamContext): WriteStream {
		return new WriteStream(this.properties, context);
	}

	clone(overrides?: Partial<WriteProperties>): WriteNode {
		return new WriteNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function getBytesPerSample(bitDepth: WavBitDepth): number {
	switch (bitDepth) {
		case "16":
			return 2;
		case "24":
			return 3;
		case "32":
		case "32f":
			return 4;
	}
}

function writeSample(buffer: Buffer, offset: number, sample: number, bitDepth: WavBitDepth): number {
	switch (bitDepth) {
		case "16": {
			const clamped = Math.max(-1, Math.min(1, sample));
			const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
			buffer.writeInt16LE(Math.round(value), offset);
			return offset + 2;
		}
		case "24": {
			const clamped = Math.max(-1, Math.min(1, sample));
			const value = Math.round(clamped < 0 ? clamped * 0x800000 : clamped * 0x7FFFFF);
			buffer[offset] = value & 0xFF;
			buffer[offset + 1] = (value >> 8) & 0xFF;
			buffer[offset + 2] = (value >> 16) & 0xFF;
			return offset + 3;
		}
		case "32": {
			const clamped = Math.max(-1, Math.min(1, sample));
			const value = clamped < 0 ? clamped * 0x80000000 : clamped * 0x7FFFFFFF;
			buffer.writeInt32LE(Math.round(value), offset);
			return offset + 4;
		}
		case "32f": {
			buffer.writeFloatLE(sample, offset);
			return offset + 4;
		}
	}
}

function writeFmtAndDataChunks(header: Buffer, offset: number, sampleRate: number, channels: number, bitDepth: WavBitDepth, dataSize: number): void {
	const bytesPerSample = getBytesPerSample(bitDepth);
	const blockAlign = channels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const bitsPerSample = bytesPerSample * 8;
	const audioFormat = bitDepth === "32f" ? 3 : 1;

	header.write("fmt ", offset);
	header.writeUInt32LE(16, offset + 4);
	header.writeUInt16LE(audioFormat, offset + 8);
	header.writeUInt16LE(channels, offset + 10);
	header.writeUInt32LE(sampleRate, offset + 12);
	header.writeUInt32LE(byteRate, offset + 16);
	header.writeUInt16LE(blockAlign, offset + 20);
	header.writeUInt16LE(bitsPerSample, offset + 22);
	header.write("data", offset + 24);
	header.writeUInt32LE(dataSize, offset + 28);
}

function buildWavHeader(dataSize: number, sampleRate: number, channels: number, bitDepth: WavBitDepth): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);

	header.write("RIFF", 0);
	header.writeUInt32LE(WAV_HEADER_SIZE - 8 + dataSize, 4);
	header.write("WAVE", 8);

	header.write("JUNK", 12);
	header.writeUInt32LE(28, 16);

	writeFmtAndDataChunks(header, 48, sampleRate, channels, bitDepth, dataSize);

	return header;
}

function buildRf64Header(dataSize: number, sampleRate: number, channels: number, bitDepth: WavBitDepth): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	const bytesPerSample = getBytesPerSample(bitDepth);
	const blockAlign = channels * bytesPerSample;
	const sampleCount = Math.floor(dataSize / blockAlign);

	header.write("RF64", 0);
	header.writeUInt32LE(UINT32_MAX, 4);
	header.write("WAVE", 8);

	header.write("ds64", 12);
	header.writeUInt32LE(28, 16);
	writeBigUInt64LE(header, 20, WAV_HEADER_SIZE - 8 + dataSize);
	writeBigUInt64LE(header, 28, dataSize);
	writeBigUInt64LE(header, 36, sampleCount);
	header.writeUInt32LE(0, 44);

	writeFmtAndDataChunks(header, 48, sampleRate, channels, bitDepth, UINT32_MAX);

	return header;
}

function writeBigUInt64LE(buffer: Buffer, offset: number, value: number): void {
	buffer.writeBigUInt64LE(BigInt(Math.floor(value)), offset);
}

export function write(path: string, options?: { bitDepth?: WavBitDepth; ffmpegPath?: string; encoding?: EncodingOptions }): WriteNode {
	return new WriteNode({
		path,
		bitDepth: options?.bitDepth ?? "16",
		ffmpegPath: options?.ffmpegPath ?? "",
		encoding: options?.encoding,
	});
}
