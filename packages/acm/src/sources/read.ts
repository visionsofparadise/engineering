import { open, stat, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import type { AudioChunk, StreamMeta } from "../module";
import { SourceModule, type SourceModuleProperties } from "../source";

export const schema = z.object({
	path: z.string().default(""),
});

export interface ReadProperties extends z.infer<typeof schema>, SourceModuleProperties {
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

export class ReadModule extends SourceModule<ReadProperties> {
	static override readonly moduleName = "Read";
	static override readonly moduleDescription = "Read audio from a file";
	static override readonly schema = schema;
	override readonly type = ["async-module", "source", "read"] as const;

	readonly bufferSize = 0;
	readonly latency = 0;

	private fileHandle?: FileHandle;
	private format?: WavFormat;
	private outputChannels = 0;
	private bytesRead = 0;

	async _init(): Promise<StreamMeta> {
		const fileInfo = await stat(this.properties.path);
		this.fileHandle = await open(this.properties.path, "r");

		const header = Buffer.alloc(44);
		await this.fileHandle.read(header, 0, 44, 0);

		const riff = header.toString("ascii", 0, 4);
		const wave = header.toString("ascii", 8, 12);

		if (riff !== "RIFF" || wave !== "WAVE") {
			throw new Error(`Not a WAV file: "${this.properties.path}"`);
		}

		// Find fmt and data chunks
		let offset = 12;
		const fileSize = fileInfo.size;
		let format: WavFormat | undefined;
		const chunkHeader = Buffer.alloc(8);

		while (offset < fileSize) {
			await this.fileHandle.read(chunkHeader, 0, 8, offset);
			const chunkId = chunkHeader.toString("ascii", 0, 4);
			const chunkSize = chunkHeader.readUInt32LE(4);

			if (chunkId === "fmt ") {
				const fmtData = Buffer.alloc(chunkSize);
				await this.fileHandle.read(fmtData, 0, chunkSize, offset + 8);

				const audioFormat = fmtData.readUInt16LE(0);
				const channels = fmtData.readUInt16LE(2);
				const sampleRate = fmtData.readUInt32LE(4);
				const blockAlign = fmtData.readUInt16LE(12);
				const bitsPerSample = fmtData.readUInt16LE(14);

				format = { sampleRate, channels, bitsPerSample, audioFormat, blockAlign, dataOffset: 0, dataSize: 0 };
			} else if (chunkId === "data") {
				if (!format) throw new Error("WAV file has data chunk before fmt chunk");
				format = { ...format, dataOffset: offset + 8, dataSize: chunkSize };
				break;
			}

			offset += 8 + chunkSize;
			if (chunkSize % 2 !== 0) offset++; // padding byte
		}

		if (!format || format.dataOffset === 0) {
			throw new Error(`Invalid WAV file: "${this.properties.path}"`);
		}

		this.format = format;
		this.bytesRead = 0;

		const selectedChannels = this.properties.channels;
		this.outputChannels = selectedChannels ? selectedChannels.length : format.channels;

		const totalFrames = Math.floor(format.dataSize / format.blockAlign);

		return {
			sampleRate: format.sampleRate,
			channels: this.outputChannels,
			duration: totalFrames,
		};
	}

	async _read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		const fh = this.fileHandle;
		const format = this.format;

		if (!fh || !format) {
			controller.close();
			return;
		}

		const remaining = format.dataSize - this.bytesRead;

		if (remaining <= 0) {
			controller.close();
			return;
		}

		const framesWanted = DEFAULT_CHUNK_SIZE;
		const bytesWanted = Math.min(framesWanted * format.blockAlign, remaining);
		const chunk = Buffer.alloc(bytesWanted);
		const { bytesRead } = await fh.read(chunk, 0, bytesWanted, format.dataOffset + this.bytesRead);

		if (bytesRead === 0) {
			controller.close();
			return;
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

		controller.enqueue({
			samples,
			offset: frameOffset,
			duration: frames,
		});
	}

	async _flush(_controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		if (this.fileHandle) {
			await this.fileHandle.close();
			this.fileHandle = undefined;
		}
	}

	clone(overrides?: Partial<ReadProperties>): ReadModule {
		return new ReadModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function readSample(data: Buffer, offset: number, bitsPerSample: number, audioFormat: number): number {
	if (audioFormat === 3) {
		// IEEE float
		if (bitsPerSample === 32) return data.readFloatLE(offset);
		if (bitsPerSample === 64) return data.readDoubleLE(offset);
	}

	// PCM integer
	if (bitsPerSample === 16) return data.readInt16LE(offset) / 0x8000;
	if (bitsPerSample === 24) {
		const byte0 = data[offset] ?? 0;
		const byte1 = data[offset + 1] ?? 0;
		const byte2 = data[offset + 2] ?? 0;
		const raw = byte0 | (byte1 << 8) | (byte2 << 16);
		return (raw > 0x7FFFFF ? raw - 0x1000000 : raw) / 0x800000;
	}
	if (bitsPerSample === 32) return data.readInt32LE(offset) / 0x80000000;
	if (bitsPerSample === 8) return ((data[offset] ?? 128) - 128) / 128;

	return 0;
}

export function read(path: string, options?: { channels?: ReadonlyArray<number> }): ReadModule {
	return new ReadModule({ path, channels: options?.channels });
}
