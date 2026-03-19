import { z } from "zod";
import type { AudioChunk, StreamContext } from "../../node";
import { BufferedTransformStream, TransformNode, type TransformNodeProperties } from "../../transform";

const cutRegionSchema = z.object({
	start: z.number().min(0).describe("Start (seconds)"),
	end: z.number().min(0).describe("End (seconds)"),
});

export const schema = z.object({
	regions: z.array(cutRegionSchema).default([]).describe("Regions"),
});

export type CutRegion = z.infer<typeof cutRegionSchema>;

export interface CutProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class CutStream extends BufferedTransformStream<CutProperties> {
	private cutSampleRate: number;
	private sortedRegions: Array<CutRegion>;
	private cumulativeRemovedFrames = 0;

	constructor(properties: CutProperties, context: StreamContext) {
		super(properties, context);
		this.cutSampleRate = context.sampleRate;
		this.sortedRegions = [...this.properties.regions].sort((left, right) => left.start - right.start);
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk | undefined {
		const sampleRate = this.cutSampleRate;
		const chunkStartSec = chunk.offset / sampleRate;
		const keepRanges: Array<{ start: number; end: number }> = [];
		let cursor = 0;

		for (const region of this.sortedRegions) {
			const cutStart = Math.max(0, Math.round((region.start - chunkStartSec) * sampleRate));
			const cutEnd = Math.min(chunk.duration, Math.round((region.end - chunkStartSec) * sampleRate));

			if (cutEnd <= 0 || cutStart >= chunk.duration) continue;

			const clampedStart = Math.max(cursor, 0);
			const clampedEnd = Math.max(clampedStart, cutStart);

			if (clampedEnd > clampedStart) {
				keepRanges.push({ start: clampedStart, end: clampedEnd });
			}

			cursor = Math.max(cursor, cutEnd);
		}

		if (cursor < chunk.duration) {
			keepRanges.push({ start: cursor, end: chunk.duration });
		}

		if (keepRanges.length === 0) return undefined;

		const totalKept = keepRanges.reduce((sum, range) => sum + (range.end - range.start), 0);

		const removedFrames = chunk.duration - totalKept;
		const adjustedOffset = chunk.offset - this.cumulativeRemovedFrames;
		this.cumulativeRemovedFrames += removedFrames;

		if (totalKept === chunk.duration) {
			return { samples: chunk.samples, offset: adjustedOffset, duration: chunk.duration };
		}

		const channels = chunk.samples.length;
		const output: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const channel = chunk.samples[ch];

			if (!channel) {
				output.push(new Float32Array(totalKept));
				continue;
			}

			const out = new Float32Array(totalKept);
			let writeOffset = 0;

			for (const range of keepRanges) {
				out.set(channel.subarray(range.start, range.end), writeOffset);
				writeOffset += range.end - range.start;
			}

			output.push(out);
		}

		return { samples: output, offset: adjustedOffset, duration: totalKept };
	}
}

export class CutNode extends TransformNode<CutProperties> {
	static override readonly moduleName = "Cut";
	static override readonly moduleDescription = "Remove a region of audio";
	static override readonly schema = schema;
	static override is(value: unknown): value is CutNode {
		return TransformNode.is(value) && value.type[2] === "cut";
	}

	override readonly type = ["async-module", "transform", "cut"] as const;
	override readonly bufferSize = 0;
	override readonly latency = 0;

	protected override createStream(context: StreamContext): CutStream {
		return new CutStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<CutProperties>): CutNode {
		return new CutNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function cut(regions: Array<CutRegion>, options?: { id?: string }): CutNode {
	return new CutNode({ regions, id: options?.id });
}
