import type { AudioChunk } from "../node";

export type BufferStorage = "memory" | "file";

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
