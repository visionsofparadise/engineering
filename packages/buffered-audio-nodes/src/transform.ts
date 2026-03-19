import { EventEmitter } from "node:events";
import { ChunkBuffer } from "./chunk-buffer";
import { BufferedAudioNode, type AudioChunk, type BufferedAudioNodeProperties, type StreamContext } from "./node";

export const WHOLE_FILE = Infinity;

export interface TransformNodeProperties extends BufferedAudioNodeProperties {
	readonly bufferSize?: number;
	readonly overlap?: number;
	readonly streamChunkSize?: number;
}

export interface TransformStreamEventMap {
	started: [];
	finished: [];
	progress: [{ framesProcessed: number; sourceTotalFrames?: number }];
}

export class BufferedTransformStream<P extends TransformNodeProperties = TransformNodeProperties> {
	readonly properties: P;
	readonly context: StreamContext;
	readonly bufferSize: number;
	readonly overlap: number;
	readonly events = new EventEmitter<TransformStreamEventMap>();

	processingMs = 0;
	framesProcessed = 0;

	private chunkBuffer?: ChunkBuffer;
	private bufferOffset = 0;
	private inferredChunkSize?: number;
	private hasStarted = false;

	private readonly streamChunkSize?: number;
	private readonly sourceTotalFrames?: number;
	private readonly memoryLimit?: number;

	constructor(properties: P, context: StreamContext) {
		this.properties = properties;
		this.context = context;

		this.bufferSize = properties.bufferSize ?? 0;
		this.overlap = properties.overlap ?? 0;
		this.streamChunkSize = properties.streamChunkSize;
		this.sourceTotalFrames = context.durationFrames;
		this.memoryLimit = context.memoryLimit;
	}

	private get outputChunkSize(): number {
		return this.streamChunkSize ?? this.inferredChunkSize ?? 44100;
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

	createTransformStream(): TransformStream<AudioChunk, AudioChunk> {
		return new TransformStream<AudioChunk, AudioChunk>({
			transform: (chunk, controller) => this.handleTransform(chunk, controller),
			flush: (controller) => this.handleFlush(controller),
		});
	}

	private async handleTransform(chunk: AudioChunk, controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.hasStarted) {
			this.hasStarted = true;

			this.events.emit("started");
		}

		this.inferredChunkSize ??= chunk.duration;

		const channels = chunk.samples.length;

		this.chunkBuffer ??= new ChunkBuffer(this.bufferSize, channels, this.memoryLimit);

		const samplesIn = chunk.duration;
		const start = performance.now();

		await this._buffer(chunk, this.chunkBuffer);

		if (this.bufferSize === 0) {
			await this.emitBuffer(controller);

			this.processingMs += performance.now() - start;
			this.framesProcessed += samplesIn;

			this.events.emit("progress", { framesProcessed: this.framesProcessed, sourceTotalFrames: this.sourceTotalFrames });

			return;
		}

		if (this.bufferSize !== WHOLE_FILE && this.chunkBuffer.frames >= this.bufferSize) {
			await this.processAndEmit(controller);

			this.events.emit("progress", { framesProcessed: this.framesProcessed, sourceTotalFrames: this.sourceTotalFrames });
		} else {
			this.processingMs += performance.now() - start;
			this.framesProcessed += samplesIn;

			this.events.emit("progress", { framesProcessed: this.framesProcessed, sourceTotalFrames: this.sourceTotalFrames });
		}
	}

	private async handleFlush(controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.chunkBuffer || this.chunkBuffer.frames === 0) {
			this.events.emit("finished");

			return;
		}

		if (this.bufferSize === 0) {
			await this.chunkBuffer.close();
			this.events.emit("finished");

			return;
		}

		try {
			await this.processAndEmit(controller);
		} finally {
			await this.chunkBuffer.close();

			this.chunkBuffer = undefined;
		}

		this.events.emit("finished");
	}

	private async processAndEmit(controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.chunkBuffer) return;

		const samplesBeforeProcess = this.chunkBuffer.frames;
		const start = performance.now();

		await this._process(this.chunkBuffer);
		await this.emitBuffer(controller);

		this.processingMs += performance.now() - start;
		this.framesProcessed += samplesBeforeProcess;
	}

	private async emitBuffer(controller: TransformStreamDefaultController<AudioChunk>): Promise<void> {
		if (!this.chunkBuffer) return;

		const emitSize = this.bufferSize === 0 ? this.chunkBuffer.frames : this.outputChunkSize;

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

		if (this.overlap > 0 && this.bufferSize !== WHOLE_FILE) {
			const overlapStart = this.chunkBuffer.frames - this.overlap;

			if (overlapStart > 0) {
				const overlapChunk = await this.chunkBuffer.read(overlapStart, this.overlap);

				await this.chunkBuffer.reset();

				await this.chunkBuffer.append(overlapChunk.samples);

				this.bufferOffset -= this.overlap;
			}
		} else {
			await this.chunkBuffer.reset();
		}
	}
}

export abstract class TransformNode<P extends TransformNodeProperties = TransformNodeProperties> extends BufferedAudioNode<P> {
	static override is(value: unknown): value is TransformNode {
		return BufferedAudioNode.is(value) && value.type[1] === "transform";
	}

	protected streamContext?: StreamContext;

	protected override _setup(context: StreamContext): void {
		this.streamContext = context;
	}

	protected abstract createStream(context: StreamContext): BufferedTransformStream;

	createTransform(): TransformStream<AudioChunk, AudioChunk> {
		if (!this.streamContext) throw new Error("Stream context not initialized");
		return this.createStream(this.streamContext).createTransformStream();
	}
}
