import { setupPipeline } from "../executor";
import { BufferedAudioNode, type AudioChunk, type BufferedAudioNodeProperties, type ExecutionProvider, type RenderOptions, type StreamContext } from "../node";
import { BufferedStream } from "../stream";

export interface SourceMetadata {
	readonly sampleRate: number;
	readonly channels: number;
	readonly durationFrames?: number;
}

export interface RenderTiming {
	readonly totalMs: number;
	readonly audioDurationMs: number;
	readonly realTimeMultiplier: number;
}

export interface SourceNodeProperties extends BufferedAudioNodeProperties {}

export abstract class BufferedSourceStream<P extends SourceNodeProperties = SourceNodeProperties> extends BufferedStream<P> {
	private framesRead = 0;

	abstract getMetadata(): Promise<SourceMetadata>;
	abstract _read(): Promise<AudioChunk | undefined>;
	abstract _flush(): Promise<void>;

	setup(context: StreamContext): ReadableStream<AudioChunk> {
		let done = false;

		this.framesRead = 0;
		const { signal, durationFrames: sourceTotalFrames, highWaterMark } = context;

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
						const chunk = await this._read();

						if (!chunk) {
							done = true;
							await this._flush();
							controller.close();

							return;
						}

						this.framesRead += chunk.samples[0]?.length ?? 0;
						controller.enqueue(chunk);
						this.events.emit("progress", { framesProcessed: this.framesRead, sourceTotalFrames });
					} catch (error) {
						done = true;
						controller.error(error);
					}
				},
				cancel: () => {
					done = true;
				},
			},
			{ highWaterMark },
		);
	}
}

export abstract class SourceNode<P extends SourceNodeProperties = SourceNodeProperties> extends BufferedAudioNode<P> {
	static override is(value: unknown): value is SourceNode {
		return BufferedAudioNode.is(value) && value.type[1] === "source";
	}

	readonly children: Array<BufferedAudioNode> = [];

	override getChildren(): ReadonlyArray<BufferedAudioNode> { return this.children; }

	to<T extends BufferedAudioNode>(child: T): T {
		this.children.push(child);

		return child;
	}

	private renderTimingData?: RenderTiming;

	get renderTiming(): RenderTiming | undefined {
		return this.renderTimingData;
	}

	protected abstract createStream(): BufferedSourceStream<P>;

	async getMetadata(): Promise<SourceMetadata> {
		const stream = this.createStream();

		return stream.getMetadata();
	}

	async setup(context: StreamContext): Promise<void> {
		const stream = this.createStream();

		this.streams.push(stream);
		const readable = stream.setup(context);
		const promises = await setupPipeline(this, readable, context);

		await Promise.all(promises);
	}

	async render(options?: RenderOptions): Promise<void> {
		const defaultProviders: ReadonlyArray<ExecutionProvider> = ["gpu", "cpu-native", "cpu"];
		const memoryLimit = options?.memoryLimit ?? 256 * 1024 * 1024;

		const meta = await this.getMetadata();

		const stages = Math.max(1, countNodes(this));
		const chunkSize = options?.chunkSize ?? 128 * 1024;
		const bytesPerChunk = meta.channels * chunkSize * 4;
		const computedHighWaterMark = Math.max(1, Math.floor(memoryLimit / (stages * bytesPerChunk)));

		const context: StreamContext = {
			executionProviders: options?.executionProviders ?? defaultProviders,
			memoryLimit,
			durationFrames: meta.durationFrames,
			highWaterMark: options?.highWaterMark ?? computedHighWaterMark,
			signal: options?.signal,
			visited: new Set<BufferedAudioNode>(),
		};

		const start = performance.now();

		try {
			await this.setup(context);
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

	for (const child of node.getChildren()) {
		count += 1 + countNodes(child);
	}

	return count;
}
