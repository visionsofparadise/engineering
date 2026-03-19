/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight interleave loops with bounds-checked typed array access */
import { randomUUID } from "node:crypto";
import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// FIX: This doesn't make sense, there's never a time that ChunkBuffer doesn't know about sampleRate and bitDepth. If chunkBuffer receives mixed values it should throw.
interface BufferChunk {
	readonly samples: Array<Float32Array>;
	readonly offset: number;
}

export type BufferStorage = "memory" | "file";

const DEFAULT_STORAGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

// TODO: We have 2 implementations here. We need FileChunkBuffer and MemoryChunkBuffer to be extensions of a base ChunkBuffer
export class ChunkBuffer {
	private _frames = 0;
	private _channels = 0;
	private storage: BufferStorage = "memory";
	private readonly storageThreshold: number;

	// Memory storage
	private memoryChannels: Array<Float32Array> = [];
	private memoryWriteOffset = 0;

	// File storage
	private tempPath?: string;
	private tempHandle?: FileHandle;
	private fileFramesWritten = 0;
	private fileChannels = 0;

	constructor(bufferSize: number, channels: number, memoryLimit?: number) {
		// Compute threshold from memory limit — use ~4% of available memory, clamped to reasonable range
		this.storageThreshold = memoryLimit ? Math.max(1024 * 1024, Math.min(memoryLimit * 0.04, 64 * 1024 * 1024)) : DEFAULT_STORAGE_THRESHOLD;
		this._channels = channels;

		const initialCapacity = bufferSize === Infinity ? 44100 : bufferSize;
		this.memoryChannels = [];

		for (let ch = 0; ch < channels; ch++) {
			this.memoryChannels.push(new Float32Array(initialCapacity));
		}

		this.memoryWriteOffset = 0;
	}

	get frames(): number {
		return this._frames;
	}

	get channels(): number {
		return this._channels;
	}

	async append(samples: Array<Float32Array>): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		// Expand channels if needed
		while (this._channels < samples.length) {
			if (this.storage === "memory") {
				const buf = new Float32Array(this.memoryChannels[0]?.length ?? duration);
				this.memoryChannels.push(buf);
			}

			this._channels++;
		}

		if (this.storage === "file") {
			await this.appendFile(samples, duration);
		} else {
			this.appendMemory(samples);
			await this.maybeFlushToFile();
		}

		this._frames += duration;
	}

	async read(offset: number, frames: number): Promise<BufferChunk> {
		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return { samples: [], offset };
		}

		if (this.storage === "file") {
			return this.readFile(offset, actualFrames);
		}

		return this.readMemory(offset, actualFrames);
	}

	async write(offset: number, samples: Array<Float32Array>): Promise<void> {
		const duration = samples[0]?.length ?? 0;

		if (duration === 0) return;

		// Expand channels if needed
		while (this._channels < samples.length) {
			if (this.storage === "memory") {
				const buf = new Float32Array(this.memoryChannels[0]?.length ?? duration);
				this.memoryChannels.push(buf);
			}

			this._channels++;
		}

		const endFrame = offset + duration;

		if (endFrame > this._frames) {
			this._frames = endFrame;
		}

		if (this.storage === "file") {
			await this.writeFile(offset, samples);
		} else {
			this.writeMemory(offset, samples);
			await this.maybeFlushToFile();
		}
	}

	async truncate(frames: number): Promise<void> {
		if (frames >= this._frames) return;

		if (this.storage === "file") {
			await this.truncateFile(frames);
		} else {
			this.truncateMemory(frames);
		}

		this._frames = frames;
	}

	async *iterate(chunkSize: number): AsyncGenerator<BufferChunk> {
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
		this.memoryWriteOffset = 0;

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

		this.memoryChannels = [];
		this.memoryWriteOffset = 0;
		this._frames = 0;
		this._channels = 0;
	}

	// --- Memory implementation ---

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

	private readMemory(offset: number, frames: number): BufferChunk {
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			const buf = this.memoryChannels[ch];
			samples.push(buf ? buf.slice(offset, offset + frames) : new Float32Array(frames));
		}

		return { samples, offset };
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

	private truncateMemory(frames: number): void {
		this.memoryWriteOffset = frames;
	}

	private async maybeFlushToFile(): Promise<void> {
		if (this.memoryWriteOffset * this._channels * 4 <= this.storageThreshold) return;

		const handle = await this.ensureFileHandle();
		const channels = this._channels;
		const frames = this.memoryWriteOffset;

		const interleaved = new Float32Array(frames * channels);

		for (let frame = 0; frame < frames; frame++) {
			const base = frame * channels;
			for (let ch = 0; ch < channels; ch++) {
				const memBuf = this.memoryChannels[ch];
				interleaved[base + ch] = memBuf ? (memBuf[frame] ?? 0) : 0;
			}
		}

		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
		await handle.write(buf, 0, buf.length, 0);
		this.fileFramesWritten = frames;

		this.memoryChannels = [];
		this.memoryWriteOffset = 0;
		this.storage = "file";
	}

	// --- File implementation ---

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
		// Layout: all channels interleaved per frame
		// [frame0_ch0, frame0_ch1, ..., frame1_ch0, frame1_ch1, ...]
		return (frame * this.fileChannels + channel) * 4;
	}

	private async appendFile(samples: Array<Float32Array>, duration: number): Promise<void> {
		const handle = await this.ensureFileHandle();
		const channels = this._channels;

		// Interleave all samples into a single buffer for one write call
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
	}

	private async readFile(offset: number, frames: number): Promise<BufferChunk> {
		if (!this.tempHandle) {
			return { samples: [], offset };
		}

		const channels = this.fileChannels;
		const byteLength = frames * channels * 4;
		const buf = Buffer.alloc(byteLength);
		const filePos = this.fileOffset(offset, 0);

		await this.tempHandle.read(buf, 0, byteLength, filePos);

		// Deinterleave using Float32Array view
		const interleaved = new Float32Array(buf.buffer, buf.byteOffset, frames * channels);
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			samples.push(new Float32Array(frames));
		}

		for (let frame = 0; frame < frames; frame++) {
			const base = frame * channels;
			for (let ch = 0; ch < channels; ch++) {
				const channel = samples[ch];

				if (channel) {
					channel[frame] = interleaved[base + ch]!;
				}
			}
		}

		return { samples, offset };
	}

	private async writeFile(offset: number, samples: Array<Float32Array>): Promise<void> {
		const handle = await this.ensureFileHandle();
		const duration = samples[0]?.length ?? 0;
		const channels = this._channels;

		// Interleave into a single buffer for one write call
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

	private async truncateFile(frames: number): Promise<void> {
		if (!this.tempHandle) return;

		await this.tempHandle.truncate(frames * this.fileChannels * 4);
		this.fileFramesWritten = frames;
	}
}
