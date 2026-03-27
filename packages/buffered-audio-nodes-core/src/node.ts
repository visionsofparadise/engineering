import { z } from "zod";
import type { BufferedStream } from "./stream";

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
	readonly children?: ReadonlyArray<BufferedAudioNode>;
}

export type BufferedAudioNodeInput<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> = P;

export abstract class BufferedAudioNode<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> {
	static readonly moduleName: string;
	static readonly moduleDescription: string = "";
	static readonly schema: z.ZodType = z.object({});

	abstract readonly type: ReadonlyArray<string>;

	static is(value: unknown): value is BufferedAudioNode {
		return typeof value === "object" && value !== null && "type" in value && Array.isArray(value.type) && value.type[0] === "buffered-audio-node";
	}

	properties: P;

	get id(): string | undefined {
		return this.properties.id;
	}

	get bufferSize(): number {
		return this.properties.bufferSize ?? 0;
	}
	get latency(): number {
		return this.properties.latency ?? 0;
	}

	get isBypassed(): boolean {
		return this.properties.bypass === true;
	}

	get children(): ReadonlyArray<BufferedAudioNode> {
		const raw = this.properties.children ?? [];
		const resolved: Array<BufferedAudioNode> = [];

		for (const child of raw) {
			if (child.isBypassed) {
				resolved.push(...child.children);
			} else {
				resolved.push(child);
			}
		}

		return resolved;
	}

	readonly streams: Array<BufferedStream> = [];

	constructor(properties?: P) {
		this.properties = {
			...properties,
		} as P;
	}

	abstract clone(overrides?: Partial<BufferedAudioNodeProperties>): BufferedAudioNode;

	async teardown(): Promise<void> {
		await this._teardown();

		for (const stream of this.streams) {
			await stream._teardown();
		}

		this.streams.length = 0;

		for (const child of this.children) {
			await child.teardown();
		}
	}

	_teardown(): Promise<void> | void {
		return;
	}
}
