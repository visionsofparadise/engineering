/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight interleave loops with bounds-checked typed array access */
import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioChunk } from "../../node";
import { ChunkBuffer } from "../chunk-buffer";

const DEFAULT_STORAGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

// FIX: Couldn't you write to an internal MemoryChunkBuffer?
export class FileChunkBuffer extends ChunkBuffer {
	private tempPath?: string;
	private tempHandle?: FileHandle;
	private fileFramesWritten = 0;
	private fileChannels: number;

	// Memory write buffer — used before flushing to file
	private memoryChannels: Array<Float32Array> = [];
	private memoryWriteOffset = 0;
	private readonly storageThreshold: number;
	private readonly initialCapacity: number;
	private flushed = false;

	constructor(bufferSize: number, channels: number, memoryLimit?: number) {
		super();

		this.storageThreshold = memoryLimit ? Math.max(1024 * 1024, Math.min(memoryLimit * 0.04, 64 * 1024 * 1024)) : DEFAULT_STORAGE_THRESHOLD;
		this._channels = channels;
		this.fileChannels = channels;

		this.initialCapacity = bufferSize === Infinity ? 44100 : bufferSize;

		for (let ch = 0; ch < channels; ch++) {
			this.memoryChannels.push(new Float32Array(this.initialCapacity));
		}
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

	private async maybeFlushToFile(): Promise<void> {
		if (this.flushed) return;
		if (this.memoryWriteOffset * this._channels * 4 <= this.storageThreshold) return;

		const channels = this._channels;
		const frames = this.memoryWriteOffset;

		// Interleave memory data
		const interleaved = new Float32Array(frames * channels);

		for (let frame = 0; frame < frames; frame++) {
			const base = frame * channels;

			for (let ch = 0; ch < channels; ch++) {
				const memBuf = this.memoryChannels[ch];

				interleaved[base + ch] = memBuf ? (memBuf[frame] ?? 0) : 0;
			}
		}

		// Write to file
		const handle = await this.ensureFileHandle();
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		await handle.write(buf, 0, buf.length, 0);
		this.fileFramesWritten = frames;

		// Clear memory and mark as flushed
		this.memoryChannels = [];
		this.memoryWriteOffset = 0;
		this.flushed = true;
	}

	async append(samples: Array<Float32Array>, sampleRate?: number, bitDepth?: number): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		this.validateAndSetMetadata(sampleRate, bitDepth);

		// Expand channels if needed
		while (this._channels < samples.length) {
			if (!this.flushed) {
				const buf = new Float32Array(this.memoryChannels[0]?.length ?? duration);

				this.memoryChannels.push(buf);
			}

			this._channels++;
		}

		if (this.flushed) {
			await this.appendFile(samples, duration);
		} else {
			this.appendMemory(samples);
			this._frames += duration;
			await this.maybeFlushToFile();
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

	private appendMemory(samples: Array<Float32Array>): void {
		const required = this.memoryWriteOffset + (samples[0]?.length ?? 0);

		for (let ch = 0; ch < samples.length; ch++) {
			const channel = samples[ch];

			if (!channel) continue;

			let buf = this.memoryChannels[ch];

			if (!buf) continue;

			if (required > buf.length) {
				const newBuf = new Float32Array(Math.max(required, buf.length * 2));

				newBuf.set(buf.subarray(0, this.memoryWriteOffset));
				this.memoryChannels[ch] = newBuf;
				buf = newBuf;
			}

			buf.set(channel, this.memoryWriteOffset);
		}

		this.memoryWriteOffset = required;
	}

	async read(offset: number, frames: number): Promise<AudioChunk> {
		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return this.buildAudioChunk([], offset);
		}

		if (this.flushed) {
			return this.readFile(offset, actualFrames);
		}

		return this.readMemory(offset, actualFrames);
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

	private readMemory(offset: number, frames: number): AudioChunk {
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			const buf = this.memoryChannels[ch];

			samples.push(buf ? buf.slice(offset, offset + frames) : new Float32Array(frames));
		}

		return this.buildAudioChunk(samples, offset);
	}

	async write(offset: number, samples: Array<Float32Array>): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		while (this._channels < samples.length) {
			if (!this.flushed) {
				const buf = new Float32Array(this.memoryChannels[0]?.length ?? duration);

				this.memoryChannels.push(buf);
			}

			this._channels++;
		}

		const endFrame = offset + duration;

		if (endFrame > this._frames) {
			this._frames = endFrame;
		}

		if (this.flushed) {
			await this.writeFile(offset, samples, duration);
		} else {
			this.writeMemory(offset, samples);
			await this.maybeFlushToFile();
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

	private writeMemory(offset: number, samples: Array<Float32Array>): void {
		for (let ch = 0; ch < samples.length; ch++) {
			const source = samples[ch];

			if (!source) continue;

			let buf = this.memoryChannels[ch];

			if (!buf) continue;

			const needed = offset + source.length;

			if (needed > buf.length) {
				const newBuf = new Float32Array(Math.max(needed, buf.length * 2));

				newBuf.set(buf.subarray(0, this.memoryWriteOffset));
				this.memoryChannels[ch] = newBuf;
				buf = newBuf;
			}

			buf.set(source, offset);

			if (needed > this.memoryWriteOffset) {
				this.memoryWriteOffset = needed;
			}
		}
	}

	async truncate(frames: number): Promise<void> {
		if (frames >= this._frames) return;

		if (this.flushed) {
			if (this.tempHandle) {
				await this.tempHandle.truncate(frames * this.fileChannels * 4);
				this.fileFramesWritten = frames;
			}
		} else {
			this.memoryWriteOffset = frames;
		}

		this._frames = frames;
	}

	async *iterate(chunkSize: number): AsyncGenerator<AudioChunk> {
		let offset = 0;

		while (offset < this._frames) {
			const frames = Math.min(chunkSize, this._frames - offset);
			const chunk = await this.read(offset, frames);

			yield chunk;
			offset += frames;
		}
	}

	async reset(): Promise<void> {
		this._frames = 0;

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
			this.flushed = false;
		}

		// Re-initialize memory arrays
		this.memoryChannels = [];

		for (let ch = 0; ch < this._channels; ch++) {
			this.memoryChannels.push(new Float32Array(this.initialCapacity));
		}

		this.memoryWriteOffset = 0;
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

		this.memoryChannels = [];
		this.memoryWriteOffset = 0;
		this.flushed = false;
		this._frames = 0;
		this._channels = 0;
		this.fileFramesWritten = 0;
	}
}
