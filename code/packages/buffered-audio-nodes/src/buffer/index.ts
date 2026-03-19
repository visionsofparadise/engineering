/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight interleave loops with bounds-checked typed array access */
import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioChunk } from "../node";

export type BufferStorage = "memory" | "file";

const DEFAULT_STORAGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

export abstract class ChunkBuffer {
	protected _frames = 0;
	protected _channels = 0;
	private _sampleRate?: number;
	private _bitDepth?: number;

	get frames(): number {
		return this._frames;
	}

	get channels(): number {
		return this._channels;
	}

	get sampleRate(): number | undefined {
		return this._sampleRate;
	}

	get bitDepth(): number | undefined {
		return this._bitDepth;
	}

	setSampleRate(rate: number): void {
		this._sampleRate = rate;
	}

	setBitDepth(depth: number): void {
		this._bitDepth = depth;
	}

	protected validateAndSetMetadata(sampleRate?: number, bitDepth?: number): void {
		if (sampleRate !== undefined) {
			if (this._sampleRate === undefined) {
				this._sampleRate = sampleRate;
			} else if (this._sampleRate !== sampleRate) {
				throw new Error(`ChunkBuffer: sample rate mismatch — expected ${this._sampleRate}, got ${sampleRate}`);
			}
		}

		if (bitDepth !== undefined) {
			if (this._bitDepth === undefined) {
				this._bitDepth = bitDepth;
			} else if (this._bitDepth !== bitDepth) {
				throw new Error(`ChunkBuffer: bit depth mismatch — expected ${this._bitDepth}, got ${bitDepth}`);
			}
		}
	}

	protected buildAudioChunk(samples: Array<Float32Array>, offset: number): AudioChunk {
		return { samples, offset, sampleRate: this._sampleRate ?? 0, bitDepth: this._bitDepth ?? 0 };
	}

	abstract append(samples: Array<Float32Array>, sampleRate?: number, bitDepth?: number): Promise<void>;
	abstract read(offset: number, frames: number): Promise<AudioChunk>;
	abstract write(offset: number, samples: Array<Float32Array>): Promise<void>;
	abstract truncate(frames: number): Promise<void>;
	abstract iterate(chunkSize: number): AsyncGenerator<AudioChunk>;
	abstract reset(): Promise<void>;
	abstract close(): Promise<void>;
}

// FIX: Factor out the chunk buffer types to their own subfolders
export class FileChunkBuffer extends ChunkBuffer {
	private tempPath?: string;
	private tempHandle?: FileHandle;
	private fileFramesWritten = 0;
	private fileChannels: number;

	constructor(channels: number) {
		super();
		this._channels = channels;
		this.fileChannels = channels;
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

	async append(samples: Array<Float32Array>, sampleRate?: number, bitDepth?: number): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		this.validateAndSetMetadata(sampleRate, bitDepth);

		// Expand channels if needed
		while (this._channels < samples.length) {
			this._channels++;
		}

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

	/**
	 * Write interleaved data directly from a buffer and set total frames. Used during memory-to-file promotion.
	 */
	async writeInterleaved(interleaved: Float32Array, frames: number, totalFrames: number): Promise<void> {
		const handle = await this.ensureFileHandle();
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		await handle.write(buf, 0, buf.length, 0);
		this.fileFramesWritten = frames;
		this._frames = totalFrames;
	}

	async read(offset: number, frames: number): Promise<AudioChunk> {
		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return this.buildAudioChunk([], offset);
		}

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

		while (this._channels < samples.length) {
			this._channels++;
		}

		const endFrame = offset + duration;

		if (endFrame > this._frames) {
			this._frames = endFrame;
		}

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

		if (this.tempHandle) {
			await this.tempHandle.truncate(frames * this.fileChannels * 4);
			this.fileFramesWritten = frames;
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

		if (this.tempHandle) {
			await this.tempHandle.truncate(0);
			this.fileFramesWritten = 0;
		}
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

		this._frames = 0;
		this._channels = 0;
		this.fileFramesWritten = 0;
	}
}

// FIX: I think you have this backwards. The file buffer works in memory until a threshold, then flushes to file. Not the memory buffer gets promoted to a file buffer.
export class MemoryChunkBuffer extends ChunkBuffer {
	private memoryChannels: Array<Float32Array> = [];
	private memoryWriteOffset = 0;
	private readonly storageThreshold: number;

	/** When memory-to-file promotion occurs, all operations delegate to this. */
	private delegate?: FileChunkBuffer;

	constructor(bufferSize: number, channels: number, memoryLimit?: number) {
		super();
		this.storageThreshold = memoryLimit ? Math.max(1024 * 1024, Math.min(memoryLimit * 0.04, 64 * 1024 * 1024)) : DEFAULT_STORAGE_THRESHOLD;
		this._channels = channels;

		const initialCapacity = bufferSize === Infinity ? 44100 : bufferSize;

		this.memoryChannels = [];

		for (let ch = 0; ch < channels; ch++) {
			this.memoryChannels.push(new Float32Array(initialCapacity));
		}

		this.memoryWriteOffset = 0;
	}

	override get frames(): number {
		return this.delegate ? this.delegate.frames : this._frames;
	}

	override get channels(): number {
		return this.delegate ? this.delegate.channels : this._channels;
	}

	override get sampleRate(): number | undefined {
		return this.delegate ? this.delegate.sampleRate : super.sampleRate;
	}

	override get bitDepth(): number | undefined {
		return this.delegate ? this.delegate.bitDepth : super.bitDepth;
	}

	override setSampleRate(rate: number): void {
		if (this.delegate) {
			this.delegate.setSampleRate(rate);
		} else {
			super.setSampleRate(rate);
		}
	}

	override setBitDepth(depth: number): void {
		if (this.delegate) {
			this.delegate.setBitDepth(depth);
		} else {
			super.setBitDepth(depth);
		}
	}

	async append(samples: Array<Float32Array>, sampleRate?: number, bitDepth?: number): Promise<void> {
		if (this.delegate) {
			await this.delegate.append(samples, sampleRate, bitDepth);

			return;
		}

		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		this.validateAndSetMetadata(sampleRate, bitDepth);

		// Expand channels if needed
		while (this._channels < samples.length) {
			const buf = new Float32Array(this.memoryChannels[0]?.length ?? duration);

			this.memoryChannels.push(buf);
			this._channels++;
		}

		this.appendMemory(samples);
		this._frames += duration;
		await this.maybePromoteToFile();
	}

	async read(offset: number, frames: number): Promise<AudioChunk> {
		if (this.delegate) return this.delegate.read(offset, frames);

		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return this.buildAudioChunk([], offset);
		}

		return this.readMemory(offset, actualFrames);
	}

	async write(offset: number, samples: Array<Float32Array>): Promise<void> {
		if (this.delegate) {
			await this.delegate.write(offset, samples);

			return;
		}

		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		while (this._channels < samples.length) {
			const buf = new Float32Array(this.memoryChannels[0]?.length ?? duration);

			this.memoryChannels.push(buf);
			this._channels++;
		}

		const endFrame = offset + duration;

		if (endFrame > this._frames) {
			this._frames = endFrame;
		}

		this.writeMemory(offset, samples);
		await this.maybePromoteToFile();
	}

	async truncate(frames: number): Promise<void> {
		if (this.delegate) {
			await this.delegate.truncate(frames);

			return;
		}

		if (frames >= this._frames) return;

		this.memoryWriteOffset = frames;
		this._frames = frames;
	}

	async *iterate(chunkSize: number): AsyncGenerator<AudioChunk> {
		if (this.delegate) {
			yield* this.delegate.iterate(chunkSize);

			return;
		}

		let offset = 0;

		while (offset < this._frames) {
			const frames = Math.min(chunkSize, this._frames - offset);
			const chunk = await this.read(offset, frames);

			yield chunk;
			offset += frames;
		}
	}

	async reset(): Promise<void> {
		if (this.delegate) {
			await this.delegate.reset();

			return;
		}

		this._frames = 0;
		this.memoryWriteOffset = 0;
	}

	async close(): Promise<void> {
		if (this.delegate) {
			await this.delegate.close();
			this.delegate = undefined;
		}

		this.memoryChannels = [];
		this.memoryWriteOffset = 0;
		this._frames = 0;
		this._channels = 0;
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

	private readMemory(offset: number, frames: number): AudioChunk {
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			const buf = this.memoryChannels[ch];

			samples.push(buf ? buf.slice(offset, offset + frames) : new Float32Array(frames));
		}

		return this.buildAudioChunk(samples, offset);
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

	private async maybePromoteToFile(): Promise<void> {
		if (this.memoryWriteOffset * this._channels * 4 <= this.storageThreshold) return;

		const channels = this._channels;
		const frames = this.memoryWriteOffset;

		const fileBuffer = new FileChunkBuffer(channels);

		// Copy metadata
		if (this.sampleRate !== undefined) fileBuffer.setSampleRate(this.sampleRate);
		if (this.bitDepth !== undefined) fileBuffer.setBitDepth(this.bitDepth);

		// Interleave memory data and write to file
		const interleaved = new Float32Array(frames * channels);

		for (let frame = 0; frame < frames; frame++) {
			const base = frame * channels;

			for (let ch = 0; ch < channels; ch++) {
				const memBuf = this.memoryChannels[ch];

				interleaved[base + ch] = memBuf ? (memBuf[frame] ?? 0) : 0;
			}
		}

		await fileBuffer.writeInterleaved(interleaved, frames, this._frames);

		// Clear memory and set delegate
		this.memoryChannels = [];
		this.memoryWriteOffset = 0;
		this.delegate = fileBuffer;
	}
}
