import { spawn, type ChildProcess } from "node:child_process";
import { open, stat, type FileHandle } from "node:fs/promises";
import { extname } from "node:path";
import { z } from "zod";
import { BufferedSourceStream, SourceNode, type SourceMetadata, type SourceNodeProperties } from "..";
import type { AudioChunk } from "../../node";
import { deinterleaveBuffer } from "../../utils/interleave";

export const schema = z.object({
	path: z.string().default("").meta({ input: "file", mode: "open" }),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	ffprobePath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "ffprobe", download: "https://ffmpeg.org/download.html" })
		.describe("FFprobe — media file analyzer (included with FFmpeg)"),
});

export interface ReadProperties extends z.infer<typeof schema>, SourceNodeProperties {
	readonly channels?: ReadonlyArray<number>;
}

const DEFAULT_CHUNK_SIZE = 44100;

interface WavFormat {
	readonly sampleRate: number;
	readonly channels: number;
	readonly bitsPerSample: number;
	readonly audioFormat: number;
	readonly blockAlign: number;
	readonly dataOffset: number;
	readonly dataSize: number;
}

interface ProbeResult {
	readonly sampleRate: number;
	readonly channels: number;
	readonly duration: number;
}

// FIX: Factor out the chunk read sources to their own subfolders
// FIX: You only factored out the streams here. I was thinking you would factor out ReadWavNode and ReadFfmpegNode
export class ReadWavStream extends BufferedSourceStream<ReadProperties> {
	private fileHandle?: FileHandle;
	private format?: WavFormat;
	private outputChannels = 0;
	private bytesRead = 0;
	private sourceSampleRate = 0;
	private sourceBitDepth = 0;

	override async getMetadata(): Promise<SourceMetadata> {
		const fh = await open(this.properties.path, "r");

		this.fileHandle = fh;

		const fileInfo = await stat(this.properties.path);

		const header = Buffer.alloc(12);

		await fh.read(header, 0, 12, 0);

		const magic = header.toString("ascii", 0, 4);
		const wave = header.toString("ascii", 8, 12);

		if ((magic !== "RIFF" && magic !== "RF64") || wave !== "WAVE") {
			throw new Error(`Not a WAV file: "${this.properties.path}"`);
		}

		const isRf64 = magic === "RF64";
		let ds64DataSize: number | undefined;

		let offset = 12;
		const fileSize = fileInfo.size;
		let format: WavFormat | undefined;
		const chunkHeader = Buffer.alloc(8);

		while (offset < fileSize) {
			await fh.read(chunkHeader, 0, 8, offset);
			const chunkId = chunkHeader.toString("ascii", 0, 4);
			const chunkSize = chunkHeader.readUInt32LE(4);

			if (chunkId === "ds64") {
				const ds64Data = Buffer.alloc(Math.min(chunkSize, 28));

				await fh.read(ds64Data, 0, ds64Data.length, offset + 8);
				ds64DataSize = Number(ds64Data.readBigUInt64LE(8));
			} else if (chunkId === "JUNK") {
				// Skip JUNK chunks (placeholder for ds64 in pre-allocated headers)
			} else if (chunkId === "fmt ") {
				if (chunkSize < 16) throw new Error("WAV fmt chunk too small");
				const fmtData = Buffer.alloc(chunkSize);

				await fh.read(fmtData, 0, chunkSize, offset + 8);

				const audioFormat = fmtData.readUInt16LE(0);
				const channels = fmtData.readUInt16LE(2);
				const sampleRate = fmtData.readUInt32LE(4);
				const blockAlign = fmtData.readUInt16LE(12);
				const bitsPerSample = fmtData.readUInt16LE(14);

				format = { sampleRate, channels, bitsPerSample, audioFormat, blockAlign, dataOffset: 0, dataSize: 0 };
			} else if (chunkId === "data") {
				if (!format) throw new Error("WAV file has data chunk before fmt chunk");
				const dataSize = isRf64 && ds64DataSize !== undefined ? ds64DataSize : chunkSize;

				format = { ...format, dataOffset: offset + 8, dataSize };
				break;
			}

			offset += 8 + chunkSize;
			if (chunkSize % 2 !== 0) offset++;
		}

		if (!format || format.dataOffset === 0) {
			throw new Error(`Invalid WAV file: "${this.properties.path}"`);
		}

		this.format = format;
		this.bytesRead = 0;
		this.sourceSampleRate = format.sampleRate;
		this.sourceBitDepth = format.bitsPerSample;

		const selectedChannels = this.properties.channels;

		this.outputChannels = selectedChannels ? selectedChannels.length : format.channels;

		const totalFrames = Math.floor(format.dataSize / format.blockAlign);

		return {
			sampleRate: format.sampleRate,
			channels: this.outputChannels,
			durationFrames: totalFrames,
		};
	}

	override async _read(): Promise<AudioChunk | undefined> {
		const fh = this.fileHandle;
		const format = this.format;

		if (!fh || !format) {
			return undefined;
		}

		const remaining = format.dataSize - this.bytesRead;

		if (remaining <= 0) {
			return undefined;
		}

		const framesWanted = DEFAULT_CHUNK_SIZE;
		const bytesWanted = Math.min(framesWanted * format.blockAlign, remaining);
		const chunk = Buffer.alloc(bytesWanted);
		const { bytesRead } = await fh.read(chunk, 0, bytesWanted, format.dataOffset + this.bytesRead);

		if (bytesRead === 0) {
			return undefined;
		}

		const frames = Math.floor(bytesRead / format.blockAlign);

		this.bytesRead += frames * format.blockAlign;

		const fileChannels = format.channels;
		const selectedChannels = this.properties.channels;

		const allChannels: Array<Float32Array> = [];

		for (let ch = 0; ch < fileChannels; ch++) {
			allChannels.push(new Float32Array(frames));
		}

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < fileChannels; ch++) {
				const byteOffset = frame * format.blockAlign + ch * (format.bitsPerSample / 8);
				const channel = allChannels[ch];

				if (channel) {
					channel[frame] = readSample(chunk, byteOffset, format.bitsPerSample, format.audioFormat);
				}
			}
		}

		let samples: Array<Float32Array>;

		if (selectedChannels) {
			samples = selectedChannels.map((srcCh) => allChannels[srcCh] ?? new Float32Array(frames));
		} else {
			samples = allChannels;
		}

		const frameOffset = Math.floor((this.bytesRead - frames * format.blockAlign) / format.blockAlign);

		return {
			samples,
			offset: frameOffset,
			sampleRate: this.sourceSampleRate,
			bitDepth: this.sourceBitDepth,
		};
	}

	override async _flush(): Promise<void> {
		if (this.fileHandle) {
			await this.fileHandle.close();
			this.fileHandle = undefined;
		}
	}

	override _teardown(): void {
		if (this.fileHandle) {
			this.fileHandle.close().catch(() => undefined);
			this.fileHandle = undefined;
		}
	}
}

export class ReadFfmpegStream extends BufferedSourceStream<ReadProperties> {
	private ffmpegProcess?: ChildProcess;
	private stdout?: NodeJS.ReadableStream;
	private frameOffset = 0;
	private remainder?: Buffer;
	private outputChannels = 0;
	private sourceSampleRate = 0;
	private sourceBitDepth = 0;

	override async getMetadata(): Promise<SourceMetadata> {
		const probe = await this.probe(this.properties.ffprobePath, this.properties.path);
		const selectedChannels = this.properties.channels;

		this.outputChannels = selectedChannels ? selectedChannels.length : probe.channels;
		this.sourceSampleRate = probe.sampleRate;
		this.sourceBitDepth = 32;

		const args = ["-i", this.properties.path, "-f", "f32le", "-acodec", "pcm_f32le", "-ar", String(probe.sampleRate)];

		if (selectedChannels) {
			const panParts = selectedChannels.map((srcCh, outCh) => `c${outCh}=c${srcCh}`);
			const layout = this.outputChannels === 1 ? "mono" : `${this.outputChannels}c`;

			args.push("-af", `pan=${layout}|${panParts.join("|")}`);
			args.push("-ac", String(this.outputChannels));
		} else {
			args.push("-ac", String(probe.channels));
		}

		args.push("pipe:1");

		const proc = spawn(this.properties.ffmpegPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.ffmpegProcess = proc;
		this.stdout = proc.stdout;
		this.remainder = undefined;
		this.frameOffset = 0;

		proc.stderr.resume();

		return {
			sampleRate: probe.sampleRate,
			channels: this.outputChannels,
			durationFrames: Math.round(probe.duration * probe.sampleRate),
		};
	}

	override async _read(): Promise<AudioChunk | undefined> {
		const bytesPerFrame = this.outputChannels * 4;
		const targetBytes = DEFAULT_CHUNK_SIZE * bytesPerFrame;

		const data = await this.readBytes(targetBytes);

		if (!data || data.length === 0) {
			return undefined;
		}

		const usableBytes = Math.floor(data.length / bytesPerFrame) * bytesPerFrame;

		if (usableBytes === 0) {
			return undefined;
		}

		const leftover = data.length - usableBytes;

		if (leftover > 0) {
			this.remainder = Buffer.from(data.buffer, data.byteOffset + usableBytes, leftover);
		}

		const frames = usableBytes / bytesPerFrame;
		const sampleBuffer = Buffer.from(data.buffer, data.byteOffset, usableBytes);
		const samples = deinterleaveBuffer(sampleBuffer, this.outputChannels);

		const offset = this.frameOffset;

		this.frameOffset += frames;

		return {
			samples,
			offset,
			sampleRate: this.sourceSampleRate,
			bitDepth: this.sourceBitDepth,
		};
	}

	override async _flush(): Promise<void> {
		const proc = this.ffmpegProcess;

		if (proc) {
			proc.kill();

			await new Promise<void>((resolve) => {
				proc.on("close", () => resolve());
				if (proc.exitCode !== null) resolve();
			});

			this.ffmpegProcess = undefined;
		}

		this.stdout = undefined;
		this.remainder = undefined;
	}

	override _teardown(): void {
		if (this.ffmpegProcess) {
			this.ffmpegProcess.kill();
			this.ffmpegProcess = undefined;
		}

		this.stdout = undefined;
		this.remainder = undefined;
	}

	private async probe(ffprobePath: string, filePath: string): Promise<ProbeResult> {
		const proc = spawn(ffprobePath, ["-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "a:0", filePath], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const chunks: Array<Buffer> = [];

		proc.stdout.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		proc.stderr.resume();

		await new Promise<void>((resolve, reject) => {
			proc.on("close", (code) => {
				if (code !== 0) {
					reject(new Error(`ffprobe exited with code ${code} for "${filePath}"`));
				} else {
					resolve();
				}
			});
			proc.on("error", (error) => {
				reject(new Error(`Failed to spawn ffprobe: ${error.message}`));
			});
		});

		const json = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
			streams?: Array<{
				sample_rate?: string;
				channels?: number;
				duration?: string;
			}>;
		};

		const stream = json.streams?.[0];

		if (!stream) {
			throw new Error(`No audio stream found in "${filePath}"`);
		}

		return {
			sampleRate: Number(stream.sample_rate) || 44100,
			channels: stream.channels ?? 1,
			duration: Number(stream.duration) || 0,
		};
	}

	private readBytes(targetBytes: number): Promise<Buffer | undefined> {
		return new Promise((resolve) => {
			const stdout = this.stdout;

			if (!stdout) {
				resolve(undefined);

				return;
			}

			const existing = this.remainder;

			this.remainder = undefined;

			const read = (): void => {
				const raw = stdout.read(targetBytes - (existing?.length ?? 0)) as Buffer | null;

				if (raw) {
					resolve(existing ? Buffer.concat([existing, raw]) : raw);

					return;
				}

				if ((stdout as NodeJS.ReadableStream & { readableEnded?: boolean }).readableEnded) {
					resolve(existing && existing.length > 0 ? existing : undefined);

					return;
				}

				const onReadable = (): void => {
					cleanup();
					read();
				};
				const onEnd = (): void => {
					cleanup();
					resolve(existing && existing.length > 0 ? existing : undefined);
				};
				const cleanup = (): void => {
					stdout.removeListener("readable", onReadable);
					stdout.removeListener("end", onEnd);
				};

				stdout.once("readable", onReadable);
				stdout.once("end", onEnd);
			};

			read();
		});
	}
}

export class ReadNode extends SourceNode<ReadProperties> {
	static override readonly moduleName = "Read";
	static override readonly moduleDescription = "Read audio from a file";
	static override readonly schema = schema;
	override readonly type = ["buffered-audio-node", "source", "read"] as const;

	protected override createStream(): ReadWavStream | ReadFfmpegStream {
		const ext = extname(this.properties.path).toLowerCase();

		if (ext === ".wav") {
			return new ReadWavStream(this.properties);
		}

		if (!this.properties.ffmpegPath || !this.properties.ffprobePath) {
			throw new Error(`Non-WAV file requires ffmpegPath and ffprobePath: "${this.properties.path}"`);
		}

		return new ReadFfmpegStream(this.properties);
	}

	clone(overrides?: Partial<ReadProperties>): ReadNode {
		return new ReadNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function readSample(data: Buffer, offset: number, bitsPerSample: number, audioFormat: number): number {
	if (audioFormat === 3) {
		if (bitsPerSample === 32) return data.readFloatLE(offset);
		if (bitsPerSample === 64) return data.readDoubleLE(offset);
	}

	if (bitsPerSample === 16) return data.readInt16LE(offset) / 0x8000;
	if (bitsPerSample === 24) {
		const byte0 = data[offset] ?? 0;
		const byte1 = data[offset + 1] ?? 0;
		const byte2 = data[offset + 2] ?? 0;
		const raw = byte0 | (byte1 << 8) | (byte2 << 16);

		return (raw > 0x7fffff ? raw - 0x1000000 : raw) / 0x800000;
	}

	if (bitsPerSample === 32) return data.readInt32LE(offset) / 0x80000000;
	if (bitsPerSample === 8) return ((data[offset] ?? 128) - 128) / 128;

	return 0;
}

export function read(path: string, options?: { channels?: ReadonlyArray<number>; ffmpegPath?: string; ffprobePath?: string }): ReadNode {
	return new ReadNode({ path, channels: options?.channels, ffmpegPath: options?.ffmpegPath ?? "", ffprobePath: options?.ffprobePath ?? "" });
}
