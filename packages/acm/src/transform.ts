import { ChunkBuffer } from "./chunk-buffer";
import { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties, type AudioChunk, type StreamContext } from "./module";

export interface TransformTiming {
	readonly totalMs: number;
	readonly samplesProcessed: number;
	readonly samplesPerSecond: number;
	readonly realTimeMultiplier: number;
}

export interface TransformModuleProperties extends AudioChainModuleProperties {
	readonly storageThreshold?: number;
	readonly streamChunkSize?: number;
	readonly overlap?: number;
}

export abstract class TransformModule extends AudioChainModule {
	static override is(value: unknown): value is TransformModule {
		return AudioChainModule.is(value) && value.type[1] === "transform";
	}

	readonly properties: TransformModuleProperties;

	private chunkBuffer?: ChunkBuffer;
	private bufferOffset = 0;
	private streamContext?: StreamContext;
	private inferredChunkSize?: number;
	private timingTotalMs = 0;
	private timingSamplesProcessed = 0;

	constructor(properties?: AudioChainModuleInput<TransformModuleProperties>) {
		super(properties);

		this.properties = {
			...properties,
			targets: properties?.targets ?? [],
		};
	}

	get overlap(): number {
		return this.properties.overlap ?? 0;
	}

	private get outputChunkSize(): number {
		return this.properties.streamChunkSize ?? this.inferredChunkSize ?? 44100;
	}

	get timing(): TransformTiming | undefined {
		if (this.timingSamplesProcessed === 0) return undefined;

		const sampleRate = this.streamContext?.sampleRate ?? 44100;
		const samplesPerSecond = this.timingTotalMs > 0 ? (this.timingSamplesProcessed / this.timingTotalMs) * 1000 : 0;

		return {
			totalMs: this.timingTotalMs,
			samplesProcessed: this.timingSamplesProcessed,
			samplesPerSecond,
			realTimeMultiplier: samplesPerSecond / sampleRate,
		};
	}

	protected override _setup(context: StreamContext): void {
		this.streamContext = context;
		this.timingTotalMs = 0;
		this.timingSamplesProcessed = 0;
	}

	_buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> | void {
		return buffer.append(chunk.samples);
	}

	_process(_buffer: ChunkBuffer): Promise<void> | void {
		return;
	}

	_unbuffer(chunk: AudioChunk): Promise<AudioChunk | undefined> | AudioChunk | undefined {
		return chunk;
	}

	createTransform(): TransformStream<AudioChunk, AudioChunk> {
		return new TransformStream<AudioChunk, AudioChunk>({
			transform: (chunk, controller) => this.handleTransform(chunk, controller),
			flush: (controller) => this.handleFlush(controller),
		});
	}

	private async handleTransform(chunk: AudioChunk, controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		this.inferredChunkSize ??= chunk.duration;

		const channels = this.streamContext?.channels ?? chunk.samples.length;

		this.chunkBuffer ??= new ChunkBuffer(this.bufferSize, channels, this.properties.storageThreshold);

		const samplesIn = chunk.duration;
		const start = performance.now();

		await this._buffer(chunk, this.chunkBuffer);

		// For bufferSize=0, immediately unbuffer each chunk
		if (this.bufferSize === 0) {
			await this.emitBuffer(controller);
			this.timingTotalMs += performance.now() - start;
			this.timingSamplesProcessed += samplesIn;
			return;
		}

		// Emit when buffer reaches bufferSize
		if (this.bufferSize !== Infinity && this.chunkBuffer.frames >= this.bufferSize) {
			await this.processAndEmit(controller);
		} else {
			this.timingTotalMs += performance.now() - start;
			this.timingSamplesProcessed += samplesIn;
		}
	}

	private async handleFlush(controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.chunkBuffer || this.chunkBuffer.frames === 0) return;

		if (this.bufferSize === 0) {
			// Already emitted everything in handleTransform
			await this.chunkBuffer.close();
			return;
		}

		await this.processAndEmit(controller);
		await this.chunkBuffer.close();
		this.chunkBuffer = undefined;
	}

	private async processAndEmit(controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.chunkBuffer) return;

		const samplesBeforeProcess = this.chunkBuffer.frames;
		const start = performance.now();

		// Run _process if subclass defines meaningful work
		await this._process(this.chunkBuffer);

		// Emit buffer contents through _unbuffer
		await this.emitBuffer(controller);

		this.timingTotalMs += performance.now() - start;
		this.timingSamplesProcessed += samplesBeforeProcess;
	}

	private async emitBuffer(controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.chunkBuffer) return;

		const chunkSize = this.bufferSize === 0 ? this.chunkBuffer.frames : Math.min(this.bufferSize === Infinity ? Infinity : this.bufferSize, this.outputChunkSize);

		const emitSize = chunkSize === Infinity ? this.outputChunkSize : chunkSize;

		for await (const chunk of this.chunkBuffer.iterate(emitSize)) {
			const adjusted: AudioChunk = {
				samples: chunk.samples,
				offset: this.bufferOffset + chunk.offset,
				duration: chunk.duration,
			};

			const result = await this._unbuffer(adjusted);

			if (result) {
				controller.enqueue(result);
			}
		}

		this.bufferOffset += this.chunkBuffer.frames;

		// Keep overlap frames for next cycle
		if (this.overlap > 0 && this.bufferSize !== Infinity) {
			const overlapStart = this.chunkBuffer.frames - this.overlap;

			if (overlapStart > 0) {
				const overlapChunk = await this.chunkBuffer.read(overlapStart, this.overlap);
				const channels = this.streamContext?.channels ?? this.chunkBuffer.channels;

				await this.chunkBuffer.close();
				this.chunkBuffer = new ChunkBuffer(this.bufferSize, channels, this.properties.storageThreshold);

				await this.chunkBuffer.append(overlapChunk.samples);
				this.bufferOffset -= this.overlap;
			}
		} else {
			// Reset buffer for next cycle
			const channels = this.streamContext?.channels ?? this.chunkBuffer.channels;
			await this.chunkBuffer.close();
			this.chunkBuffer = new ChunkBuffer(this.bufferSize, channels, this.properties.storageThreshold);
		}
	}
}
