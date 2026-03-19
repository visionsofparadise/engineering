import { z } from "zod";
import type { BufferedStream } from "./stream";

// FIX: put this in a schema.ts file
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
	readonly sampleRate: number;
	readonly bitDepth: number;
}

export type ExecutionProvider = "gpu" | "cpu-native" | "cpu";

export interface StreamContext {
	readonly executionProviders: ReadonlyArray<ExecutionProvider>;
	readonly memoryLimit: number;
	readonly durationFrames?: number;
	readonly highWaterMark: number;
	readonly signal?: AbortSignal;
	readonly visited: Set<BufferedAudioNode>;
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
	readonly bypass?: boolean;
	readonly previousProperties?: BufferedAudioNodeProperties;
	readonly bufferSize?: number;
	readonly latency?: number;
}

export type BufferedAudioNodeInput<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> = P;

// FIX: put this in a schema.ts file
export type { ZodType as ModuleSchema } from "zod";

export abstract class BufferedAudioNode<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> {
	static readonly moduleName: string;
	static readonly moduleDescription: string = "";
	static readonly schema: z.ZodType = z.object({});

	static is(value: unknown): value is BufferedAudioNode {
		return typeof value === "object" && value !== null && "type" in value && Array.isArray(value.type) && value.type[0] === "buffered-audio-node";
	}

	abstract readonly type: ReadonlyArray<string>;

	readonly properties: P;

	get bufferSize(): number {
		return this.properties.bufferSize ?? 0;
	}
	get latency(): number {
		return this.properties.latency ?? 0;
	}

	readonly streams: Array<BufferedStream> = [];

	constructor(properties?: P) {
		this.properties = {
			...properties,
		} as P;
	}

	get id(): string | undefined {
		return this.properties.id;
	}

	abstract clone(overrides?: Partial<BufferedAudioNodeProperties>): BufferedAudioNode;

	getChildren(): ReadonlyArray<BufferedAudioNode> {
		return [];
	}

	async teardown(): Promise<void> {
		await this._teardown();
		for (const stream of this.streams) {
			await stream._teardown();
		}

		this.streams.length = 0;
		for (const child of this.getChildren()) {
			await child.teardown();
		}
	}

	_teardown(): Promise<void> | void {
		return;
	}
}
