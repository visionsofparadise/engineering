import type { AudioChainModuleInput, AudioChunk } from "../module";
import { TransformModule, type TransformModuleProperties } from "../transform";

export interface FanTransformProperties extends TransformModuleProperties {
	readonly branches: ReadonlyArray<TransformModule>;
}

export class FanTransform extends TransformModule {
	readonly type = ["async-module", "transform", "fan"] as const;

	readonly properties: FanTransformProperties;
	readonly bufferSize = 0;
	readonly latency = 0;

	private readonly writers: Array<WritableStreamDefaultWriter<AudioChunk>> = [];

	constructor(properties: AudioChainModuleInput<FanTransformProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	override createTransform(): TransformStream<AudioChunk, AudioChunk> {
		const branchStreams = this.properties.branches.map((unit) => unit.createTransform());

		const writers = branchStreams.map((stream) => stream.writable.getWriter());
		this.writers.push(...writers);

		return new TransformStream<AudioChunk, AudioChunk>({
			transform: async (chunk, _controller) => {
				await Promise.all(writers.map((writer) => writer.write(chunk)));
			},
			flush: async () => {
				await Promise.all(writers.map((writer) => writer.close()));
			},
		});
	}

	clone(overrides?: Partial<FanTransformProperties>): FanTransform {
		return new FanTransform({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function fan(...branches: Array<TransformModule>): FanTransform {
	return new FanTransform({ branches });
}
