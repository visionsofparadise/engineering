import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "buffered-audio-nodes-core";
import { detectClippedRegions, reconstructClippedRegion } from "./utils/clip-detection";

export const schema = z.object({
	threshold: z.number().min(0).max(1).multipleOf(0.01).default(0.99).describe("Threshold"),
	method: z.enum(["ar", "sparse"]).default("ar").describe("Method"),
});

export interface DeClipProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Detects clipped samples and reconstructs the original waveform using
 * iterative AR interpolation.
 *
 * @see Janssen, A.J.E.M., Veldhuis, R.N.J., Vries, L.B. (1986). "Adaptive interpolation of
 *   discrete-time signals that can be modeled as autoregressive processes."
 *   IEEE TASSP, 34(2), 317-330. https://doi.org/10.1109/TASSP.1986.1164824
 * @see Zaviska, P., Rajmic, P., Ozerov, A., Rencker, L. (2021). "A Survey and an Extensive
 *   Evaluation of Popular Audio Declipping Methods."
 *   IEEE JSTSP, 15(1), 5-24. https://doi.org/10.1109/JSTSP.2020.3042071
 */
export class DeClipStream extends BufferedTransformStream<DeClipProperties> {
	override _buffer(chunk: AudioChunk, buffer: ChunkBuffer): void | Promise<void> {
		if (this.bufferSize === 0) {
			this.bufferSize = Math.round(chunk.sampleRate * 0.05);
		}

		return super._buffer(chunk, buffer);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		for await (const chunk of buffer.iterate(this.bufferSize)) {
			const samples = chunk.samples.map((channel) => {
				const output = new Float32Array(channel);
				const regions = detectClippedRegions(channel, this.properties.threshold);

				for (const region of regions) {
					reconstructClippedRegion(output, region.start, region.end, this.properties.threshold);
				}

				return output;
			});

			await buffer.write(chunk.offset, samples);
		}
	}
}

export class DeClipNode extends TransformNode<DeClipProperties> {
	static override readonly moduleName = "De-Clip";
	static override readonly moduleDescription = "Restore clipped audio peaks";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeClipNode {
		return TransformNode.is(value) && value.type[2] === "de-clip";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-clip"] as const;

	override createStream(): DeClipStream {
		return new DeClipStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeClipProperties>): DeClipNode {
		return new DeClipNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deClip(options?: { threshold?: number; method?: "ar" | "sparse"; id?: string }): DeClipNode {
	const parsed = schema.parse(options ?? {});

	return new DeClipNode({ ...parsed, id: options?.id });
}
