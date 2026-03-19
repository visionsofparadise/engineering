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
	readonly sampleRate: number;
	readonly bitDepth: number;
}

export type ExecutionProvider = "gpu" | "cpu-native" | "cpu";

// FIX: Rename this to SourceMetadata, and move to Source file
export interface StreamMeta {
	readonly sampleRate: number;
	readonly channels: number;
	readonly durationFrames?: number;
}

export interface StreamContext {
	readonly executionProviders: ReadonlyArray<ExecutionProvider>;
	readonly memoryLimit: number;
	readonly durationFrames?: number;
}

export interface RenderOptions {
	readonly chunkSize?: number;
	readonly highWaterMark?: number;
	readonly memoryLimit?: number;
	readonly signal?: AbortSignal;
	readonly executionProviders?: ReadonlyArray<ExecutionProvider>;
}

// FIX: We need isBypassed here
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
		// FIX: We're still using the async-module term from the initial implementation, this is now buffered-audio-node
		return typeof value === "object" && value !== null && "type" in value && Array.isArray(value.type) && value.type[0] === "async-module";
	}

	abstract readonly type: ReadonlyArray<string>;

	readonly properties: P;

	abstract readonly bufferSize: number;
	abstract readonly latency: number;

	// FIX: We need a base stream type, we're redefining implementation across them, we don't have a generic type we can use either
	readonly streams: Array<{ _teardown?(): Promise<void> | void }> = [];

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

	to<T extends BufferedAudioNode>(child: T): T {
		this.children.push(child);

		return child;
	}

	// FIX: We need to talk about the process of teardown vs clearStreams. When we do each, what our process is etc.
	async teardown(): Promise<void> {
		for (const stream of this.streams) {
			await stream._teardown?.();
		}

		await Promise.all(this.children.map((child) => child.teardown()));
	}

	clearStreams(): void {
		this.streams.length = 0;
		for (const child of this.children) {
			child.clearStreams();
		}
	}
}
