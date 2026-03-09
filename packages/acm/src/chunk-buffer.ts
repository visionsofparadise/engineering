import { open, unlink, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AudioChunk } from "./module";

export type BufferStorage = "memory" | "file";

const STORAGE_THRESHOLD = 10 * 1024 * 1024; // 10MB

export class ChunkBuffer {
	private _frames = 0;
	private _channels = 0;
	private readonly storage: BufferStorage;

	// Memory storage
	private memoryChannels: Array<Array<Float32Array>> = [];

	// File storage
	private tempPath?: string;
	private tempHandle?: FileHandle;
	private fileFramesWritten = 0;
	private fileChannels = 0;

	constructor(bufferSize: number, channels: number, storageThreshold = STORAGE_THRESHOLD) {
		const estimatedBytes = (bufferSize === Infinity ? storageThreshold + 1 : bufferSize) * channels * 4;
		this.storage = estimatedBytes > storageThreshold ? "file" : "memory";
		this._channels = channels;

		if (this.storage === "memory") {
			this.memoryChannels = [];

			for (let ch = 0; ch < channels; ch++) {
				this.memoryChannels.push([]);
			}
		}
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
				this.memoryChannels.push([]);
			}

			this._channels++;
		}

		if (this.storage === "file") {
			await this.appendFile(samples, duration);
		} else {
			this.appendMemory(samples);
		}

		this._frames += duration;
	}

	async read(offset: number, frames: number): Promise<AudioChunk> {
		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return { samples: [], offset, duration: 0 };
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
				this.memoryChannels.push([]);
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

	async *iterate(chunkSize: number): AsyncGenerator<AudioChunk> {
		let offset = 0;

		while (offset < this._frames) {
			const frames = Math.min(chunkSize, this._frames - offset);
			const chunk = await this.read(offset, frames);

			yield chunk;
			offset += frames;
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
		this._frames = 0;
		this._channels = 0;
	}

	// --- Memory implementation ---

	private appendMemory(samples: Array<Float32Array>): void {
		for (let ch = 0; ch < samples.length; ch++) {
			const channel = samples[ch];

			if (channel) {
				this.memoryChannels[ch]?.push(channel.slice());
			}
		}
	}

	private readMemory(offset: number, frames: number): AudioChunk {
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			const merged = this.mergeMemoryChannel(ch);
			samples.push(merged.slice(offset, offset + frames));
		}

		return { samples, offset, duration: frames };
	}

	private writeMemory(offset: number, samples: Array<Float32Array>): void {
		for (let ch = 0; ch < samples.length; ch++) {
			const source = samples[ch];

			if (!source) continue;

			const merged = this.mergeMemoryChannel(ch);
			const needed = offset + source.length;

			if (needed > merged.length) {
				const expanded = new Float32Array(needed);
				expanded.set(merged);
				expanded.set(source, offset);
				this.memoryChannels[ch] = [expanded];
			} else {
				merged.set(source, offset);
				this.memoryChannels[ch] = [merged];
			}
		}
	}

	private truncateMemory(frames: number): void {
		for (let ch = 0; ch < this._channels; ch++) {
			const merged = this.mergeMemoryChannel(ch);
			this.memoryChannels[ch] = [merged.slice(0, frames)];
		}
	}

	private mergeMemoryChannel(ch: number): Float32Array {
		const chunks = this.memoryChannels[ch];

		if (!chunks || chunks.length === 0) return new Float32Array(0);

		if (chunks.length === 1) return chunks[0] ?? new Float32Array(0);

		const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const merged = new Float32Array(totalLength);
		let writeOffset = 0;

		for (const chunk of chunks) {
			merged.set(chunk, writeOffset);
			writeOffset += chunk.length;
		}

		chunks.length = 0;
		chunks.push(merged);

		return merged;
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
		const buf = Buffer.alloc(duration * channels * 4);

		for (let frame = 0; frame < duration; frame++) {
			for (let ch = 0; ch < channels; ch++) {
				buf.writeFloatLE(samples[ch]?.[frame] ?? 0, (frame * channels + ch) * 4);
			}
		}

		const offset = this.fileOffset(this.fileFramesWritten, 0);
		await handle.write(buf, 0, buf.length, offset);

		this.fileFramesWritten += duration;
	}

	private async readFile(offset: number, frames: number): Promise<AudioChunk> {
		if (!this.tempHandle) {
			return { samples: [], offset, duration: 0 };
		}

		const channels = this.fileChannels;
		const byteLength = frames * channels * 4;
		const buf = Buffer.alloc(byteLength);
		const filePos = this.fileOffset(offset, 0);

		await this.tempHandle.read(buf, 0, byteLength, filePos);

		// Deinterleave into per-channel arrays
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < this._channels; ch++) {
			samples.push(new Float32Array(frames));
		}

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < channels; ch++) {
				const channel = samples[ch];

				if (channel) {
					channel[frame] = buf.readFloatLE((frame * channels + ch) * 4);
				}
			}
		}

		return { samples, offset, duration: frames };
	}

	private async writeFile(offset: number, samples: Array<Float32Array>): Promise<void> {
		const handle = await this.ensureFileHandle();
		const duration = samples[0]?.length ?? 0;
		const channels = this._channels;

		// Interleave into a single buffer for one write call
		const buf = Buffer.alloc(duration * channels * 4);

		for (let frame = 0; frame < duration; frame++) {
			for (let ch = 0; ch < channels; ch++) {
				buf.writeFloatLE(samples[ch]?.[frame] ?? 0, (frame * channels + ch) * 4);
			}
		}

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
