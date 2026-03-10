import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	threshold: z.number().min(0).max(1).multipleOf(0.001).default(0.001).describe("Threshold"),
	margin: z.number().min(0).max(1).multipleOf(0.001).default(0.01).describe("Margin"),
	start: z.boolean().default(true).describe("Start"),
	end: z.boolean().default(true).describe("End"),
});

export interface TrimProperties extends TransformModuleProperties {
	readonly threshold?: number;
	readonly margin?: number;
	readonly start?: boolean;
	readonly end?: boolean;
}

export class TrimModule extends TransformModule<TrimProperties> {
	static override readonly moduleName = "Trim";
	static override readonly schema = schema;
	static override is(value: unknown): value is TrimModule {
		return TransformModule.is(value) && value.type[2] === "trim";
	}

	override readonly type = ["async-module", "transform", "trim"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private trimSampleRate = 44100;

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
