/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight interleave loops with bounds-checked typed array access */
import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioChunk } from "../../node";
import { ChunkBuffer } from "..";
import { MemoryChunkBuffer } from "../memory";

const DEFAULT_STORAGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

export class FileChunkBuffer extends ChunkBuffer {
	private tempPath?: string;
	private tempHandle?: FileHandle;
	private fileFramesWritten = 0;
	private fileChannels: number;

	private memoryBuffer: MemoryChunkBuffer;
	private readonly storageThreshold: number;
	private readonly initialBufferSize: number;
	private readonly initialChannels: number;
	private flushed = false;

	constructor(bufferSize: number, channels: number, memoryLimit?: number) {
		super();

		this.storageThreshold = memoryLimit ? Math.max(1024 * 1024, Math.min(memoryLimit * 0.04, 64 * 1024 * 1024)) : DEFAULT_STORAGE_THRESHOLD;
		this._channels = channels;
		this.fileChannels = channels;
		this.initialBufferSize = bufferSize;
		this.initialChannels = channels;

		this.memoryBuffer = new MemoryChunkBuffer(bufferSize, channels);
	}

	private syncMetadata(): void {
		this._frames = this.memoryBuffer.frames;
		this._channels = this.memoryBuffer.channels;
		if (this.memoryBuffer.sampleRate) this.setSampleRate(this.memoryBuffer.sampleRate);
		if (this.memoryBuffer.bitDepth) this.setBitDepth(this.memoryBuffer.bitDepth);
	}

	private async ensureFileHandle(): Promise<FileHandle> {
		if (!this.tempHandle) {
			this.tempPath = join(tmpdir(), `chunk-buffer-${randomUUID()}.bin`);
			this.tempHandle = await open(this.tempPath, "w+");

			this.fileFramesWritten = 0;
			this.fileChannels = this._channels;
		}

		return this.tempHandle;
	}

	private fileOffset(frame: number, channel: number): number {
		return (frame * this.fileChannels + channel) * 4;
	}

	private async flushToFile(): Promise<void> {
		const channels = this.memoryBuffer.channels;
		const frames = this.memoryBuffer.frames;

		const handle = await this.ensureFileHandle();
		let filePos = 0;

		for await (const chunk of this.memoryBuffer.iterate(8192)) {
			const chunkFrames = chunk.samples[0]?.length ?? 0;
			const interleaved = new Float32Array(chunkFrames * channels);

			for (let frame = 0; frame < chunkFrames; frame++) {
				const base = frame * channels;

				for (let ch = 0; ch < channels; ch++) {
					interleaved[base + ch] = chunk.samples[ch]?.[frame] ?? 0;
				}
			}

			const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

			await handle.write(buf, 0, buf.length, filePos);
			filePos += buf.length;
		}

		this.fileFramesWritten = frames;
		this.flushed = true;
	}

	async append(samples: Array<Float32Array>, sampleRate?: number, bitDepth?: number): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		if (this.flushed) {
			this.validateAndSetMetadata(sampleRate, bitDepth);

			while (this._channels < samples.length) {
				this._channels++;
			}

			await this.appendFile(samples, duration);
		} else {
			await this.memoryBuffer.append(samples, sampleRate, bitDepth);
			this.syncMetadata();

			if (this.memoryBuffer.frames * this.memoryBuffer.channels * 4 > this.storageThreshold) {
				await this.flushToFile();
			}
		}
	}

	private async appendFile(samples: Array<Float32Array>, duration: number): Promise<void> {
		const handle = await this.ensureFileHandle();
		const channels = this._channels;

		const interleaved = new Float32Array(duration * channels);

		for (let frame = 0; frame < duration; frame++) {
			const base = frame * channels;

			for (let ch = 0; ch < channels; ch++) {
				interleaved[base + ch] = samples[ch]?.[frame] ?? 0;
			}
		}

		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
		const offset = this.fileOffset(this.fileFramesWritten, 0);

		await handle.write(buf, 0, buf.length, offset);

		this.fileFramesWritten += duration;
		this._frames += duration;
	}

	async read(offset: number, frames: number): Promise<AudioChunk> {
		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return this.buildAudioChunk([], offset);
		}

		if (this.flushed) {
			return this.readFile(offset, actualFrames);
		}

		return this.memoryBuffer.read(offset, actualFrames);
	}

	private async readFile(offset: number, actualFrames: number): Promise<AudioChunk> {
		if (!this.tempHandle) {
			return this.buildAudioChunk([], offset);
		}

		const channels = this.fileChannels;
		const byteLength = actualFrames * channels * 4;
		const buf = Buffer.alloc(byteLength);
		const filePos = this.fileOffset(offset, 0);

		await this.tempHandle.read(buf, 0, byteLength, filePos);

		const interleaved = new Float32Array(buf.buffer, buf.byteOffset, actualFrames * channels);
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			samples.push(new Float32Array(actualFrames));
		}

		for (let frame = 0; frame < actualFrames; frame++) {
			const base = frame * channels;

			for (let ch = 0; ch < channels; ch++) {
				const channel = samples[ch];

				if (channel) {
					channel[frame] = interleaved[base + ch]!;
				}
			}
		}

		return this.buildAudioChunk(samples, offset);
	}

	async write(offset: number, samples: Array<Float32Array>): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		if (this.flushed) {
			while (this._channels < samples.length) {
				this._channels++;
			}

			const endFrame = offset + duration;

			if (endFrame > this._frames) {
				this._frames = endFrame;
			}

			await this.writeFile(offset, samples, duration);
		} else {
			await this.memoryBuffer.write(offset, samples);
			this.syncMetadata();

			if (this.memoryBuffer.frames * this.memoryBuffer.channels * 4 > this.storageThreshold) {
				await this.flushToFile();
			}
		}
	}

	private async writeFile(offset: number, samples: Array<Float32Array>, duration: number): Promise<void> {
		const handle = await this.ensureFileHandle();
		const channels = this._channels;

		const interleaved = new Float32Array(duration * channels);

		for (let frame = 0; frame < duration; frame++) {
			const base = frame * channels;

			for (let ch = 0; ch < channels; ch++) {
				interleaved[base + ch] = samples[ch]?.[frame] ?? 0;
			}
		}

		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
		const filePos = this.fileOffset(offset, 0);

		await handle.write(buf, 0, buf.length, filePos);

		if (offset + duration > this.fileFramesWritten) {
			this.fileFramesWritten = offset + duration;
		}
	}

	async truncate(frames: number): Promise<void> {
		if (frames >= this._frames) return;

		if (this.flushed) {
			if (this.tempHandle) {
				await this.tempHandle.truncate(frames * this.fileChannels * 4);
				this.fileFramesWritten = frames;
			}

			this._frames = frames;
		} else {
			await this.memoryBuffer.truncate(frames);
			this.syncMetadata();
		}
	}

	async *iterate(chunkSize: number): AsyncGenerator<AudioChunk> {
		if (!this.flushed) {
			yield* this.memoryBuffer.iterate(chunkSize);

			return;
		}

		let offset = 0;

		while (offset < this._frames) {
			const frames = Math.min(chunkSize, this._frames - offset);
			const chunk = await this.readFile(offset, frames);

			yield chunk;
			offset += frames;
		}
	}

	async reset(): Promise<void> {
		if (this.flushed) {
			if (this.tempHandle) {
				await this.tempHandle.close();
				this.tempHandle = undefined;
			}

			if (this.tempPath) {
				await unlink(this.tempPath).catch(() => undefined);
				this.tempPath = undefined;
			}

			this.fileFramesWritten = 0;
		}

		this.memoryBuffer = new MemoryChunkBuffer(this.initialBufferSize, this.initialChannels);
		this.flushed = false;
		this._frames = 0;
	}

	async close(): Promise<void> {
		if (this.tempHandle) {
			await this.tempHandle.close();
			this.tempHandle = undefined;
		}

		if (this.tempPath) {
			await unlink(this.tempPath).catch(() => undefined);
			this.tempPath = undefined;
		}

		await this.memoryBuffer.close();
		this.flushed = false;
		this._frames = 0;
		this._channels = 0;
		this.fileFramesWritten = 0;
	}
}
