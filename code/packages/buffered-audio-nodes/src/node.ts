import { z } from "zod";
import type { OptionalProperties } from "./utils/RequiredProperties";

export interface FileInputMeta {
	readonly input: "file" | "folder";
	readonly mode?: "open" | "save";
	readonly accept?: string;
	readonly binary?: string;
	readonly download?: string;
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
	readonly durationFrames?: number;
}

export interface StreamContext extends StreamMeta {
	readonly executionProviders: ReadonlyArray<ExecutionProvider>;
	readonly memoryLimit: number;
}

export interface RenderOptions {
	readonly chunkSize?: number;
	readonly highWaterMark?: number;
	readonly memoryLimit?: number;
	readonly signal?: AbortSignal;
	readonly executionProviders?: ReadonlyArray<ExecutionProvider>;
}

export interface BufferedAudioNodeProperties {
	readonly id?: string;
	readonly children: Array<BufferedAudioNode>;
	readonly previousProperties?: BufferedAudioNodeProperties;
}

export type BufferedAudioNodeInput<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> = OptionalProperties<P, "children">;

export type { ZodType as ModuleSchema } from "zod";

export abstract class BufferedAudioNode<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> {
	static readonly moduleName: string;
	static readonly moduleDescription: string = "";
	static readonly schema: z.ZodType = z.object({});

	static is(value: unknown): value is BufferedAudioNode {
		return typeof value === "object" && value !== null && "type" in value && Array.isArray(value.type) && value.type[0] === "async-module";
	}

	abstract readonly type: ReadonlyArray<string>;

	readonly properties: P;

	abstract readonly bufferSize: number;
	abstract readonly latency: number;

	protected sourceTotalFrames?: number;

	constructor(properties?: BufferedAudioNodeInput<P>) {
		this.properties = {
			...properties,
			children: properties?.children ?? [],
		} as P;
	}

	get id(): string | undefined {
		return this.properties.id;
	}

	get children(): Array<BufferedAudioNode> {
		return this.properties.children;
	}

	abstract clone(overrides?: Partial<BufferedAudioNodeProperties>): BufferedAudioNode;

	to<T extends BufferedAudioNode>(target: T): T {
		this.children.push(target);
		return target;
	}

	async setup(context: StreamContext): Promise<void> {
		this.sourceTotalFrames = context.durationFrames;

		await Promise.all([Promise.resolve(this._setup(context)), ...this.children.map((child) => child.setup(context))]);
	}

	protected _setup(_context: StreamContext): Promise<void> | void {
		return;
	}

	async teardown(): Promise<void> {
		await Promise.all(this.children.map((child) => child.teardown()));

		await this._teardown();
	}

	protected _teardown(): Promise<void> | void {
		return;
	}
}
