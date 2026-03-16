import { AudioChainModule, type AudioChainModuleProperties, type AudioChunk, type ExecutionProvider, type RenderOptions, type StreamContext, type StreamMeta } from "./module";
import type { TargetModule } from "./target";
import type { TransformModule, TransformTiming } from "./transform";

export interface RenderTiming {
	readonly totalMs: number;
	readonly audioDurationMs: number;
	readonly realTimeMultiplier: number;
}

export interface SourceModuleProperties extends AudioChainModuleProperties {}

export abstract class SourceModule<P extends SourceModuleProperties = SourceModuleProperties> extends AudioChainModule<P> {
	static override is(value: unknown): value is SourceModule {
		return AudioChainModule.is(value) && value.type[1] === "source";
	}

	private renderTimingData?: RenderTiming;
	private framesRead = 0;
	protected readable?: ReadableStream<AudioChunk>;

	abstract _read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void>;
	abstract _flush(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void>;
	abstract _init(): Promise<StreamMeta>;

	get renderTiming(): RenderTiming | undefined {
		return this.renderTimingData;
	}

	async render(options?: RenderOptions): Promise<void> {
		const defaultProviders: ReadonlyArray<ExecutionProvider> = ["gpu", "cpu-native", "cpu"];
		const memoryLimit = options?.memoryLimit ?? 256 * 1024 * 1024;
		const meta = await this._init();
		const context: StreamContext = { ...meta, executionProviders: options?.executionProviders ?? defaultProviders, memoryLimit };

		await this.setup(context);

		const stages = Math.max(1, collectPipeline(this).length);
		const chunkSize = options?.chunkSize ?? 128 * 1024;
		const bytesPerChunk = context.channels * chunkSize * 4;
		const computedHighWaterMark = Math.max(1, Math.floor(memoryLimit / (stages * bytesPerChunk)));
		const highWaterMark = options?.highWaterMark ?? computedHighWaterMark;

		const start = performance.now();

		try {
			this.readable = this.createReadable({ ...options, highWaterMark });
			this.emit("started");

			const pipeline = this.buildPipeline(this, options);
			await pipeline;
			this.emit("finished");
		} finally {
			const totalMs = performance.now() - start;

			const audioDurationMs = meta.duration !== undefined ? (meta.duration / meta.sampleRate) * 1000 : 0;

			this.renderTimingData = {
				totalMs,
				audioDurationMs,
				realTimeMultiplier: audioDurationMs > 0 ? audioDurationMs / totalMs : 0,
			};

			await this.teardown();
		}
	}

	private createReadable(options?: RenderOptions): ReadableStream<AudioChunk> {
		let done = false;
		this.framesRead = 0;
		const signal = options?.signal;
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
							this.emit("progress", { framesProcessed: this.framesRead, sourceTotalFrames: this.sourceTotalFrames });
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
				this.framesRead += chunk.duration;
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

	private buildPipeline(source: SourceModule, _options?: RenderOptions): Promise<void> {
		let currentReadable = source.readable;
		if (!currentReadable) {
			return Promise.reject(new Error("Source readable not created"));
		}

		const targets = collectPipeline(source);

		for (const unit of targets) {
			if (isTransformAsyncModule(unit)) {
				const transform = unit.createTransform();
				currentReadable = currentReadable.pipeThrough(transform);
			} else if (isTargetAsyncModule(unit)) {
				const writable = unit.createWritable();
				return currentReadable.pipeTo(writable);
			}
		}

		// If no target, consume the stream to drive it
		return currentReadable.pipeTo(new WritableStream<AudioChunk>());
	}

	collectTimings(): Array<{ name: string; timing: TransformTiming }> {
		return collectTimings(collectPipeline(this));
	}
}

export function collectPipeline(unit: AudioChainModule): Array<AudioChainModule> {
	const result: Array<AudioChainModule> = [];
	let current: AudioChainModule = unit;
	while (current.next) {
		result.push(current.next);
		current = current.next;
	}
	return result;
}

export function collectTimings(pipeline: Array<AudioChainModule>): Array<{ name: string; timing: TransformTiming }> {
	const result: Array<{ name: string; timing: TransformTiming }> = [];

	for (const module of pipeline) {
		if (isTransformAsyncModule(module)) {
			const timing = module.timing;

			if (timing) {
				result.push({ name: module.type[2] ?? module.type[1] ?? "unknown", timing });
			}
		}
	}

	return result;
}

function isTransformAsyncModule(value: unknown): value is TransformModule {
	return AudioChainModule.is(value) && value.type[1] === "transform";
}

function isTargetAsyncModule(value: unknown): value is TargetModule {
	return AudioChainModule.is(value) && value.type[1] === "target";
}
