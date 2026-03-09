import { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties, type AudioChunk, type RenderOptions, type StreamContext } from "./module";
import type { TargetModule } from "./target";
import type { TransformModule, TransformTiming } from "./transform";

export interface RenderTiming {
	readonly totalMs: number;
	readonly audioDurationMs: number;
	readonly realTimeMultiplier: number;
}

export interface SourceModuleProperties extends AudioChainModuleProperties {}

export abstract class SourceModule extends AudioChainModule {
	static is(value: unknown): value is SourceModule {
		return AudioChainModule.is(value) && value.type[1] === "source";
	}

	readonly properties: SourceModuleProperties;

	private renderTimingData?: RenderTiming;
	protected readable?: ReadableStream<AudioChunk>;

	constructor(properties?: AudioChainModuleInput<SourceModuleProperties>) {
		super(properties);

		this.properties = {
			...properties,
			targets: properties?.targets ?? [],
		};
	}

	abstract _read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void>;
	abstract _flush(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void>;
	abstract _init(): Promise<StreamContext>;

	get renderTiming(): RenderTiming | undefined {
		return this.renderTimingData;
	}

	async render(options?: RenderOptions): Promise<void> {
		const meta = await this._init();
		await this.setup(meta);

		const start = performance.now();

		try {
			this.readable = this.createReadable(options);
			const pipeline = this.buildPipeline(this, options);
			await pipeline;
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
		return new ReadableStream<AudioChunk>(
			{
				pull: async (controller) => {
					if (done) return;
					try {
						await this._read(controller);
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

	private buildPipeline(source: SourceModule, _options?: RenderOptions): Promise<void> {
		let currentReadable = source.readable;
		if (!currentReadable) {
			return Promise.reject(new Error("Source readable not created"));
		}

		const targets = this.collectPipeline(source);

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
		const pipeline = this.collectPipeline(this);
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

	private collectPipeline(unit: AudioChainModule): Array<AudioChainModule> {
		const result: Array<AudioChainModule> = [];
		let current: AudioChainModule = unit;
		while (current.targets.length > 0) {
			const target = current.targets[0];
			if (!target) break;
			result.push(target);
			current = target;
		}
		return result;
	}
}

function isTransformAsyncModule(value: unknown): value is TransformModule {
	return AudioChainModule.is(value) && value.type[1] === "transform";
}

function isTargetAsyncModule(value: unknown): value is TargetModule {
	return AudioChainModule.is(value) && value.type[1] === "target";
}
