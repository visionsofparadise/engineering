import { spawn } from "node:child_process";
import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import { AudioChunk, StreamContext } from "../module";
import { TargetModule, type TargetModuleProperties } from "../target";

export type WavBitDepth = "16" | "24" | "32" | "32f";

export interface EncodingOptions {
	readonly format: "wav" | "flac" | "mp3" | "aac";
	readonly bitrate?: string;
	readonly vbr?: number;
}

export const schema = z.object({
	path: z.string().default("").meta({ input: "file", mode: "save" }),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg" }).describe("FFmpeg Path"),
	bitDepth: z.enum(["16", "24", "32", "32f"]).default("16"),
});

export interface TranscodeWriteProperties extends TargetModuleProperties {
	readonly path: string;
	readonly ffmpegPath: string;
	readonly bitDepth: WavBitDepth;
	readonly encoding?: EncodingOptions;
}

const WAV_HEADER_SIZE = 44;

export class TranscodeWriteModule extends TargetModule<TranscodeWriteProperties> {
	static override readonly moduleName = "Transcode Write";
	static override readonly moduleDescription = "Write audio to a file";
	static override readonly schema = schema;
	override readonly type = ["async-module", "target", "transcode-write"] as const;

	readonly bufferSize = 0;
	readonly latency = 0;

	private fileHandle?: FileHandle;
	private ffmpegStdin?: NodeJS.WritableStream;
	private ffmpegDone?: Promise<void>;
	private sampleRate = 44100;
	private channels = 1;
	private bytesWritten = 0;
	private useEncoding = false;
	private headerWritten = false;

	override async _setup(context: StreamContext): Promise<void> {
		this.sampleRate = context.sampleRate;
		this.channels = context.channels;
		this.bytesWritten = 0;
		this.headerWritten = false;

		const encoding = this.properties.encoding;
		this.useEncoding = encoding !== undefined && encoding.format !== "wav";

		if (this.useEncoding && encoding) {
			const binaryPath = this.properties.ffmpegPath;
			const args = this.buildFfmpegArgs(encoding);

			const proc = spawn(binaryPath, args, {
				stdio: ["pipe", "ignore", "pipe"],
			});

			this.ffmpegStdin = proc.stdin;

			this.ffmpegStdin.on("error", () => {
				// Ignore EPIPE — expected when ffmpeg closes early
			});

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

	async _write(chunk: AudioChunk): Promise<void> {
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

	async _close(): Promise<void> {
		if (this.useEncoding) {
			if (this.ffmpegStdin) {
				this.ffmpegStdin.end();
			}
			if (this.ffmpegDone) {
				await this.ffmpegDone;
			}
			this.ffmpegStdin = undefined;
			this.ffmpegDone = undefined;
		} else if (this.fileHandle) {
			const header = buildWavHeader(this.bytesWritten, this.sampleRate, this.channels, this.properties.bitDepth);
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
		if (!stdin) return Promise.resolve();

		const canWrite = stdin.write(data);

		if (!canWrite) {
			return new Promise<void>((resolve) => {
				stdin.once("drain", resolve);
			});
		}

		return Promise.resolve();
	}

	clone(overrides?: Partial<TranscodeWriteProperties>): TranscodeWriteModule {
		return new TranscodeWriteModule({ ...this.properties, previousProperties: this.properties, ...overrides });
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

function buildWavHeader(dataSize: number, sampleRate: number, channels: number, bitDepth: WavBitDepth): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	const bytesPerSample = getBytesPerSample(bitDepth);
	const blockAlign = channels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const bitsPerSample = bytesPerSample * 8;
	const audioFormat = bitDepth === "32f" ? 3 : 1;

	header.write("RIFF", 0);
	header.writeUInt32LE(dataSize + 36, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(audioFormat, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(dataSize, 40);

	return header;
}

export function transcodeWrite(
	ffmpegPath: string,
	path: string,
	options?: { bitDepth?: WavBitDepth; encoding?: EncodingOptions },
): TranscodeWriteModule {
	return new TranscodeWriteModule({
		path,
		ffmpegPath,
		bitDepth: options?.bitDepth ?? "16",
		encoding: options?.encoding,
	});
}
