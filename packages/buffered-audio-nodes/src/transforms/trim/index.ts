import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import { findFirstAbove, findLastAbove } from "./utils/silence";

export const schema = z.object({
	threshold: z.number().min(0).max(1).multipleOf(0.001).default(0.001).describe("Threshold"),
	margin: z.number().min(0).max(1).multipleOf(0.001).default(0.01).describe("Margin"),
	start: z.boolean().default(true).describe("Start"),
	end: z.boolean().default(true).describe("End"),
});

export interface TrimProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class TrimStream extends BufferedTransformStream<TrimProperties> {
	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const allAudio = await buffer.read(0, frames);
		const channels = allAudio.samples.length;

		if (channels === 0 || frames === 0) return;

		const threshold = this.properties.threshold;
		const marginSeconds = this.properties.margin;
		const marginFrames = Math.round(marginSeconds * (this.sampleRate ?? 44100));
		const trimStart = this.properties.start;
		const trimEnd = this.properties.end;

		const firstAbove = findFirstAbove(allAudio.samples, frames, threshold);

		if (firstAbove >= frames) {
			await buffer.truncate(0);

			return;
		}

		let startFrame = 0;
		let endFrame = frames;

		if (trimStart) {
			startFrame = Math.max(0, firstAbove - marginFrames);
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
}

export class TrimNode extends TransformNode<TrimProperties> {
	static override readonly moduleName = "Trim";
	static override readonly moduleDescription = "Remove silence from start and end";
	static override readonly schema = schema;
	static override is(value: unknown): value is TrimNode {
		return TransformNode.is(value) && value.type[2] === "trim";
	}

	override readonly type = ["buffered-audio-node", "transform", "trim"] as const;

	constructor(properties: TrimProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): TrimStream {
		return new TrimStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<TrimProperties>): TrimNode {
		return new TrimNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function trim(options?: { threshold?: number; margin?: number; start?: boolean; end?: boolean; id?: string }): TrimNode {
	const parsed = schema.parse(options ?? {});

	return new TrimNode({ ...parsed, id: options?.id });
}
