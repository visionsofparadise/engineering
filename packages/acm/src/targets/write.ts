import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import type { AudioChunk, StreamContext } from "../module";
import { TargetModule, type TargetModuleProperties } from "../target";

export type WavBitDepth = "16" | "24" | "32" | "32f";

export const schema = z.object({
	path: z.string().default(""),
	bitDepth: z.enum(["16", "24", "32", "32f"]).default("16"),
});

export interface WriteProperties extends TargetModuleProperties {
	readonly path: string;
	readonly bitDepth: WavBitDepth;
}

const WAV_HEADER_SIZE = 44;

export class WriteModule extends TargetModule<WriteProperties> {
	static override readonly moduleName = "Write";
	static override readonly moduleDescription = "Write audio to a file";
	static override readonly schema = schema;
	override readonly type = ["async-module", "target", "write"] as const;

	readonly bufferSize = 0;
	readonly latency = 0;

	private fileHandle?: FileHandle;
	private sampleRate = 44100;
	private channels = 1;
	private bytesWritten = 0;

	override async _setup(context: StreamContext): Promise<void> {
		this.sampleRate = context.sampleRate;
		this.channels = context.channels;
		this.bytesWritten = 0;

		this.fileHandle = await open(this.properties.path, "w");
		const header = buildWavHeader(0, this.sampleRate, this.channels, this.properties.bitDepth);
		await this.fileHandle.write(header, 0, WAV_HEADER_SIZE, 0);
	}

	async _write(chunk: AudioChunk): Promise<void> {
		const bytes = this.convertChunk(chunk);

		if (this.fileHandle) {
			await this.fileHandle.write(bytes, 0, bytes.length, WAV_HEADER_SIZE + this.bytesWritten);
		}

		this.bytesWritten += bytes.length;
	}

	async _close(): Promise<void> {
		if (this.fileHandle) {
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

	clone(overrides?: Partial<WriteProperties>): WriteModule {
		return new WriteModule({ ...this.properties, previousProperties: this.properties, ...overrides });
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

export function write(path: string, options?: { bitDepth?: WavBitDepth }): WriteModule {
	return new WriteModule({
		path,
		bitDepth: options?.bitDepth ?? "16",
	});
}
