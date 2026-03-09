import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export interface TrimProperties extends TransformModuleProperties {
	readonly threshold?: number;
	readonly margin?: number;
	readonly start?: boolean;
	readonly end?: boolean;
}

export class TrimModule extends TransformModule {
	static override is(value: unknown): value is TrimModule {
		return TransformModule.is(value) && value.type[2] === "trim";
	}

	readonly type = ["async-module", "transform", "trim"] as const;
	readonly properties: TrimProperties;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private trimSampleRate = 44100;

	constructor(properties?: AudioChainModuleInput<TrimProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties?.targets ?? [] };
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.trimSampleRate = context.sampleRate;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const allAudio = await buffer.read(0, frames);
		const channels = allAudio.samples.length;

		if (channels === 0 || frames === 0) return;

		const threshold = this.properties.threshold ?? 0.001;
		const marginSeconds = this.properties.margin ?? 0.01;
		const marginFrames = Math.round(marginSeconds * this.trimSampleRate);
		const trimStart = this.properties.start !== false;
		const trimEnd = this.properties.end !== false;

		let startFrame = 0;
		let endFrame = frames;

		if (trimStart) {
			startFrame = findFirstAbove(allAudio.samples, frames, threshold);
			startFrame = Math.max(0, startFrame - marginFrames);
		}

		if (trimEnd) {
			endFrame = findLastAbove(allAudio.samples, frames, threshold) + 1;
			endFrame = Math.min(frames, endFrame + marginFrames);
		}

		if (startFrame >= endFrame) return;
		if (startFrame === 0 && endFrame === frames) return;

		const trimmedLength = endFrame - startFrame;
		const trimmed: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const channel = allAudio.samples[ch];

			if (!channel) {
				trimmed.push(new Float32Array(trimmedLength));
				continue;
			}

			trimmed.push(channel.subarray(startFrame, endFrame));
		}

		await buffer.truncate(0);
		await buffer.append(trimmed);
	}

	clone(overrides?: Partial<TrimProperties>): TrimModule {
		return new TrimModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function findFirstAbove(samples: Array<Float32Array>, frames: number, threshold: number): number {
	for (let index = 0; index < frames; index++) {
		for (const channel of samples) {
			if (Math.abs(channel[index] ?? 0) > threshold) {
				return index;
			}
		}
	}

	return frames;
}

function findLastAbove(samples: Array<Float32Array>, frames: number, threshold: number): number {
	for (let index = frames - 1; index >= 0; index--) {
		for (const channel of samples) {
			if (Math.abs(channel[index] ?? 0) > threshold) {
				return index;
			}
		}
	}

	return 0;
}

export function trim(options?: { threshold?: number; margin?: number; start?: boolean; end?: boolean; id?: string }): TrimModule {
	return new TrimModule({
		threshold: options?.threshold,
		margin: options?.margin,
		start: options?.start,
		end: options?.end,
		id: options?.id,
	});
}
