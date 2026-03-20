/* eslint-disable @typescript-eslint/require-await -- methods are async to satisfy the abstract ChunkBuffer interface */
import type { AudioChunk } from "../../node";
import { ChunkBuffer } from "../chunk-buffer";

export class MemoryChunkBuffer extends ChunkBuffer {
	private memoryChannels: Array<Float32Array> = [];
	private memoryWriteOffset = 0;

	constructor(bufferSize: number, channels: number) {
		super();
		this._channels = channels;

		const initialCapacity = bufferSize === Infinity ? 44100 : bufferSize;

		for (let ch = 0; ch < channels; ch++) {
			this.memoryChannels.push(new Float32Array(initialCapacity));
		}
	}

	async append(samples: Array<Float32Array>, sampleRate?: number, bitDepth?: number): Promise<void> {
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
	}

	async read(offset: number, frames: number): Promise<AudioChunk> {
		const actualFrames = Math.min(frames, this._frames - offset);

		if (actualFrames <= 0) {
			return this.buildAudioChunk([], offset);
		}

		return this.readMemory(offset, actualFrames);
	}

	async write(offset: number, samples: Array<Float32Array>): Promise<void> {
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
	}

	async truncate(frames: number): Promise<void> {
		if (frames >= this._frames) return;

		this.memoryWriteOffset = frames;
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
		this.memoryWriteOffset = 0;
	}

	async close(): Promise<void> {
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
}
