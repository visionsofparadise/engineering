import { z } from "zod";
import type { OptionalProperties } from "./utils/RequiredProperties";

export interface FileInputMeta {
	readonly input: "file" | "folder";
	readonly mode?: "open" | "save";
	readonly accept?: string;
	readonly binary?: string;
}

export interface AudioChunk {
	readonly samples: Array<Float32Array>;
	readonly offset: number;
	readonly duration: number;
}

export type ExecutionProvider = "gpu" | "cpu-native" | "cpu";

export interface StreamMeta {
	readonly sampleRate: number;
	readonly channels: number;
	readonly duration?: number;
}

export interface StreamContext extends StreamMeta {
	readonly executionProviders: ReadonlyArray<ExecutionProvider>;
}

export interface RenderOptions {
	readonly chunkSize?: number;
	readonly highWaterMark?: number;
	readonly memoryLimit?: number;
	readonly signal?: AbortSignal;
	readonly executionProviders?: ReadonlyArray<ExecutionProvider>;
}

export interface AudioChainModuleProperties {
	readonly id?: string;
	readonly targets: Array<AudioChainModule>;
	readonly previousProperties?: AudioChainModuleProperties;
}

export type AudioChainModuleInput<P extends AudioChainModuleProperties = AudioChainModuleProperties> = OptionalProperties<P, "targets">;

export type { ZodType as ModuleSchema } from "zod";

export interface ModuleEventMap {
	setup: [];
	started: [];
	finished: [];
	progress: [{ framesProcessed: number; sourceTotalFrames?: number }];
}

type EventListener<K extends keyof ModuleEventMap> = (...args: ModuleEventMap[K]) => void;

export abstract class AudioChainModule<P extends AudioChainModuleProperties = AudioChainModuleProperties> {
	static readonly moduleName: string;
	static readonly moduleDescription: string = "";
	static readonly schema: z.ZodType = z.object({});

	static is(value: unknown): value is AudioChainModule {
		return typeof value === "object" && value !== null && "type" in value && Array.isArray(value.type) && value.type[0] === "async-module";
	}

	abstract readonly type: ReadonlyArray<string>;

	readonly properties: P;

	abstract readonly bufferSize: number;
	abstract readonly latency: number;

	private readonly listeners = new Map<string, Set<Function>>();
	protected sourceTotalFrames?: number;

	constructor(properties?: AudioChainModuleInput<P>) {
		this.properties = {
			...properties,
			targets: properties?.targets ?? [],
		} as P;
	}

	get id(): string | undefined {
		return this.properties.id;
	}

	get targets(): Array<AudioChainModule> {
		return this.properties.targets;
	}

	on<K extends keyof ModuleEventMap>(event: K, listener: EventListener<K>): void {
		let set = this.listeners.get(event);
		if (!set) {
			set = new Set();
			this.listeners.set(event, set);
		}
		set.add(listener);
	}

	off<K extends keyof ModuleEventMap>(event: K, listener: EventListener<K>): void {
		this.listeners.get(event)?.delete(listener);
	}

	protected emit<K extends keyof ModuleEventMap>(event: K, ...args: ModuleEventMap[K]): void {
		const set = this.listeners.get(event);
		if (!set) return;
		for (const listener of set) {
			(listener as EventListener<K>)(...args);
		}
	}

	abstract clone(overrides?: Partial<AudioChainModuleProperties>): AudioChainModule;

	to(target: AudioChainModule): void {
		this.properties.targets.push(target);
	}

	async setup(context: StreamContext): Promise<void> {
		this.sourceTotalFrames = context.duration;

		await Promise.all([this._setup(context), ...this.targets.map((target) => target.setup(context))]);

		this.emit("setup");
	}

	protected _setup(_context: StreamContext): Promise<void> | void {
		return;
	}

	async teardown(): Promise<void> {
		await Promise.all(this.targets.map((target) => target.teardown()));

		await this._teardown();
	}

	protected _teardown(): Promise<void> | void {
		return;
	}
}
