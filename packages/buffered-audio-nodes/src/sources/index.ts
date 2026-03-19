import { EventEmitter } from "node:events";
import { detectCycle, setupPipeline } from "../executor";
import { BufferedAudioNode, type AudioChunk, type BufferedAudioNodeProperties, type ExecutionProvider, type RenderOptions, type StreamContext, type StreamMeta } from "../node";

export interface RenderTiming {
	readonly totalMs: number;
	readonly audioDurationMs: number;
	readonly realTimeMultiplier: number;
}

export interface SourceNodeProperties extends BufferedAudioNodeProperties {}

export interface SourceStreamEventMap {
	started: [];
	finished: [];
	progress: [{ framesProcessed: number; sourceTotalFrames?: number }];
}

export abstract class BufferedSourceStream<P extends SourceNodeProperties = SourceNodeProperties> {
	readonly properties: P;
	readonly events = new EventEmitter<SourceStreamEventMap>();

	private framesRead = 0;

	constructor(properties: P) {
		this.properties = properties;
	}

	abstract _init(): Promise<StreamMeta>;
	abstract _read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void>;
	abstract _flush(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void>;

	createReadableStream(context: StreamContext, options?: { highWaterMark?: number; signal?: AbortSignal }): ReadableStream<AudioChunk> {
		let done = false;
		this.framesRead = 0;
		const signal = options?.signal;
		const sourceTotalFrames = context.durationFrames;
		return new ReadableStream<AudioChunk>(
			{
				pull: async (controller) => {
					if (done) return;
					if (signal?.aborted) {
						done = true;
						controller.close();
						return;
					}
					try {
						const framesBefore = this.framesRead;
						const wrappedController = this.wrapController(controller);
						await this._read(wrappedController);
						if (this.framesRead > framesBefore) {
							this.events.emit("progress", { framesProcessed: this.framesRead, sourceTotalFrames });
						}
					} catch (error) {
						done = true;
						controller.error(error);
					}
				},
				cancel: () => {
					done = true;
				},
			},
			{
				highWaterMark: options?.highWaterMark ?? 1,
			},
		);
	}

	private wrapController(controller: ReadableStreamDefaultController<AudioChunk>): ReadableStreamDefaultController<AudioChunk> {
		return {
			get desiredSize() {
				return controller.desiredSize;
			},
			enqueue: (chunk: AudioChunk) => {
				this.framesRead += chunk.samples[0]?.length ?? 0;
				controller.enqueue(chunk);
			},
			close: () => {
				controller.close();
			},
			error: (reason?: unknown) => {
				controller.error(reason);
			},
		};
	}
}

export abstract class SourceNode<P extends SourceNodeProperties = SourceNodeProperties> extends BufferedAudioNode<P> {
	static override is(value: unknown): value is SourceNode {
		return BufferedAudioNode.is(value) && value.type[1] === "source";
	}

	private renderTimingData?: RenderTiming;

	get renderTiming(): RenderTiming | undefined {
		return this.renderTimingData;
	}

	protected abstract createStream(): BufferedSourceStream<P>;

	async render(options?: RenderOptions): Promise<void> {
		const defaultProviders: ReadonlyArray<ExecutionProvider> = ["gpu", "cpu-native", "cpu"];
		const memoryLimit = options?.memoryLimit ?? 256 * 1024 * 1024;

		detectCycle(this);

		// FIX: The separate path for clearStreams and teardown is pointing to the fact that it is too hard to manually go through the steps of render externally, you have imlemented this purely to make benchmarking easier. The actual solution is to refactor render to be a series of function calls that can be done externally, so benchmarking can intercept at any stage it needs to.
		this.clearStreams();

		const stream = this.createStream();
		const meta = await stream._init();
		const context: StreamContext = { executionProviders: options?.executionProviders ?? defaultProviders, memoryLimit, durationFrames: meta.durationFrames };

		const stages = Math.max(1, countNodes(this));
		const chunkSize = options?.chunkSize ?? 128 * 1024;
		const bytesPerChunk = meta.channels * chunkSize * 4;
		const computedHighWaterMark = Math.max(1, Math.floor(memoryLimit / (stages * bytesPerChunk)));
		const highWaterMark = options?.highWaterMark ?? computedHighWaterMark;

		const start = performance.now();

		try {
			const readable = stream.createReadableStream(context, { ...options, highWaterMark });
			const promises = setupPipeline(this, readable, context);
			await Promise.all(promises);
		} finally {
			const totalMs = performance.now() - start;
			const audioDurationMs = meta.durationFrames !== undefined ? (meta.durationFrames / meta.sampleRate) * 1000 : 0;
			this.renderTimingData = {
				totalMs,
				audioDurationMs,
				realTimeMultiplier: audioDurationMs > 0 ? audioDurationMs / totalMs : 0,
			};
			await this.teardown();
		}
	}
}

function countNodes(node: BufferedAudioNode): number {
	let count = 0;
	for (const child of node.children) {
		count += 1 + countNodes(child);
	}
	return count;
}
