import type { ChunkBuffer } from "../buffer";
import { FileChunkBuffer } from "../buffer/file";
import { BufferedAudioNode, type AudioChunk, type BufferedAudioNodeProperties, type StreamContext } from "../node";
import { BufferedStream } from "../stream";
import { TargetNode } from "../targets";
import { teeReadable } from "../utils/tee-readable";

export const WHOLE_FILE = Infinity;

export interface TransformNodeProperties extends BufferedAudioNodeProperties {
	readonly overlap?: number;
	readonly streamChunkSize?: number;
}

export class BufferedTransformStream<P extends TransformNodeProperties = TransformNodeProperties> extends BufferedStream<P> {
	bufferSize: number;
	readonly overlap: number;

	processingMs = 0;
	framesProcessed = 0;

	private chunkBuffer?: ChunkBuffer;
	private bufferOffset = 0;
	private inferredChunkSize?: number;
	private hasStarted = false;

	private readonly streamChunkSize?: number;
	private sourceTotalFrames?: number;
	private memoryLimit?: number;

	constructor(properties: P) {
		super(properties);

		this.bufferSize = properties.bufferSize ?? 0;
		this.overlap = properties.overlap ?? 0;
		this.streamChunkSize = properties.streamChunkSize;
	}

	protected get sampleRate(): number | undefined {
		return this.chunkBuffer?.sampleRate;
	}

	protected get bitDepth(): number | undefined {
		return this.chunkBuffer?.bitDepth;
	}

	private get outputChunkSize(): number {
		return this.streamChunkSize ?? this.inferredChunkSize ?? 44100;
	}

	async setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		this.sourceTotalFrames = context.durationFrames;
		this.memoryLimit = context.memoryLimit;

		await this._setup(context);

		return input.pipeThrough(this.createTransformStream());
	}

	_setup(_context: StreamContext): Promise<void> | void {
		return;
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

		const chunkFrames = chunk.samples[0]?.length ?? 0;

		this.inferredChunkSize ??= chunkFrames;

		const channels = chunk.samples.length;

		this.chunkBuffer ??= new FileChunkBuffer(this.bufferSize, channels, this.memoryLimit);

		const samplesIn = chunkFrames;
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
				sampleRate: chunk.sampleRate,
				bitDepth: chunk.bitDepth,
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

				await this.chunkBuffer.append(overlapChunk.samples, overlapChunk.sampleRate, overlapChunk.bitDepth);

				this.bufferOffset -= this.overlap;
			}
		} else {
			await this.chunkBuffer.reset();
		}
	}

	_buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> | void {
		return buffer.append(chunk.samples, chunk.sampleRate, chunk.bitDepth);
	}

	_process(_buffer: ChunkBuffer): Promise<void> | void {
		return;
	}

	_unbuffer(chunk: AudioChunk): Promise<AudioChunk | undefined> | AudioChunk | undefined {
		return chunk;
	}
}

export abstract class TransformNode<P extends TransformNodeProperties = TransformNodeProperties> extends BufferedAudioNode<P> {
	static override is(value: unknown): value is TransformNode {
		return BufferedAudioNode.is(value) && value.type[1] === "transform";
	}

	to<T extends BufferedAudioNode>(child: T): T {
		this.properties = { ...this.properties, children: [...(this.properties.children ?? []), child] } as P;

		return child;
	}

	abstract createStream(): BufferedTransformStream;

	async setup(readable: ReadableStream<AudioChunk>, context: StreamContext): Promise<Array<Promise<void>>> {
		const stream = this.createStream();

		this.streams.push(stream);

		const output = await stream.setup(readable, context);

		return this.setupChildren(output, context);
	}

	private async setupChildren(readable: ReadableStream<AudioChunk>, context: StreamContext): Promise<Array<Promise<void>>> {
		const resolved = this.children;
		const pairs = teeReadable(readable, resolved);

		const nested = await Promise.all(
			pairs.map(async ([stream, child]) => {
				if (context.visited.has(child)) throw new Error("Cycle detected in node graph");

				context.visited.add(child);

				if (child instanceof TransformNode || child instanceof TargetNode) return child.setup(stream, context);

				throw new Error(`Unknown child node type`);
			}),
		);

		return nested.flat();
	}
}
