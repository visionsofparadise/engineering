import { open, type FileHandle } from "node:fs/promises";
import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	outputPath: z.string().default("").meta({ input: "file", mode: "save" }).describe("Output Path"),
	resolution: z.number().min(100).max(10000).multipleOf(100).default(1000).describe("Resolution"),
});

export interface WaveformProperties extends z.infer<typeof schema>, TransformModuleProperties {}

const HEADER_SIZE = 16;

export class WaveformModule extends TransformModule<WaveformProperties> {
	static override readonly moduleName = "Waveform";
	static override readonly moduleDescription = "Generate waveform visualization data";
	static override readonly schema = schema;

	static override is(value: unknown): value is WaveformModule {
		return TransformModule.is(value) && value.type[2] === "waveform";
	}

	override readonly type = ["async-module", "transform", "waveform"] as const;
	override readonly bufferSize = 0;
	override readonly latency = 0;

	private fileHandle?: FileHandle;
	private channels = 1;
	private samplesPerPoint = 44;
	private totalPoints = 0;
	private fileOffset = HEADER_SIZE;

	private samplesInCurrentWindow = 0;
	private currentMin: Float32Array = new Float32Array(0);
	private currentMax: Float32Array = new Float32Array(0);

	private writeBuffer?: Buffer;
	private writeBufferOffset = 0;
	private writeBufferFileOffset = HEADER_SIZE;
	private readonly WRITE_BATCH_POINTS = 1000;

	protected override _setup(context: StreamContext): void {
		super._setup(context);

		this.channels = context.channels;
		this.samplesPerPoint = Math.max(1, Math.round(context.sampleRate / this.properties.resolution));
		this.totalPoints = 0;
		this.fileOffset = HEADER_SIZE;
		this.samplesInCurrentWindow = 0;
		this.currentMin = new Float32Array(this.channels).fill(1);
		this.currentMax = new Float32Array(this.channels).fill(-1);

		const pointByteSize = this.channels * 8;
		this.writeBuffer = Buffer.alloc(this.WRITE_BATCH_POINTS * pointByteSize);
		this.writeBufferOffset = 0;
		this.writeBufferFileOffset = HEADER_SIZE;
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.fileHandle = await open(this.properties.outputPath, "w");

		const header = Buffer.alloc(HEADER_SIZE);
		header.writeUInt32LE(context.sampleRate, 0);
		header.writeUInt32LE(context.channels, 4);
		header.writeUInt32LE(this.properties.resolution, 8);
		header.writeUInt32LE(0, 12);
		await this.fileHandle.write(header, 0, HEADER_SIZE, 0);
	}

	override _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> | void {
		this.processWaveformData(chunk);

		return buffer.append(chunk.samples);
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		return chunk;
	}

	private processWaveformData(chunk: AudioChunk): void {
		const frames = chunk.duration;

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < this.channels; ch++) {
				const sample = chunk.samples[ch]?.[frame] ?? 0;
				const currentMinCh = this.currentMin[ch];
				const currentMaxCh = this.currentMax[ch];

				if (currentMinCh !== undefined && sample < currentMinCh) this.currentMin[ch] = sample;

				if (currentMaxCh !== undefined && sample > currentMaxCh) this.currentMax[ch] = sample;
			}

			this.samplesInCurrentWindow++;

			if (this.samplesInCurrentWindow >= this.samplesPerPoint) {
				this.flushPoint();
			}
		}
	}

	private flushPoint(): void {
		if (!this.fileHandle) return;

		const pointByteSize = this.channels * 8;

		if (this.writeBuffer && this.writeBufferOffset + pointByteSize > this.writeBuffer.length) {
			this.flushWriteBufferSync();
		}

		const buf = this.writeBuffer;
		if (!buf) return;
		const offset = this.writeBufferOffset;

		for (let ch = 0; ch < this.channels; ch++) {
			buf.writeFloatLE(this.currentMin[ch] ?? 0, offset + ch * 8);
			buf.writeFloatLE(this.currentMax[ch] ?? 0, offset + ch * 8 + 4);
		}

		this.writeBufferOffset += pointByteSize;
		this.fileOffset += pointByteSize;
		this.totalPoints++;

		this.samplesInCurrentWindow = 0;
		this.currentMin.fill(1);
		this.currentMax.fill(-1);
	}

	private flushWriteBufferSync(): void {
		if (!this.fileHandle || !this.writeBuffer || this.writeBufferOffset === 0) return;

		void this.fileHandle.write(this.writeBuffer, 0, this.writeBufferOffset, this.writeBufferFileOffset);
		this.writeBufferFileOffset += this.writeBufferOffset;
		this.writeBufferOffset = 0;
	}

	protected override async _teardown(): Promise<void> {
		if (!this.fileHandle) return;

		if (this.samplesInCurrentWindow > 0) {
			this.flushPoint();
		}

		// Await final batch write
		if (this.writeBuffer && this.writeBufferOffset > 0) {
			await this.fileHandle.write(this.writeBuffer, 0, this.writeBufferOffset, this.writeBufferFileOffset);
			this.writeBufferOffset = 0;
		}
		this.writeBuffer = undefined;

		const header = Buffer.alloc(4);
		header.writeUInt32LE(this.totalPoints, 0);

		await this.fileHandle.write(header, 0, 4, 12);
		await this.fileHandle.close();
		this.fileHandle = undefined;
	}

	clone(overrides?: Partial<WaveformProperties>): WaveformModule {
		return new WaveformModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function waveform(outputPath: string, options?: { resolution?: number }): WaveformModule {
	return new WaveformModule({
		outputPath,
		resolution: options?.resolution ?? 1000,
	});
}
