import { z } from "zod";
import { BufferedTransformStream, TransformNode, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { AudioChunk } from "../../node";
import { detectPlosive, removePlosive } from "./utils/plosive";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	frequency: z.number().min(50).max(500).multipleOf(10).default(200).describe("Frequency"),
});

export interface DePlosiveProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class DePlosiveStream extends BufferedTransformStream<DePlosiveProperties> {
	private lpState: Array<number> = [];

	override _buffer(chunk: AudioChunk, buffer: ChunkBuffer): void | Promise<void> {
		if (this.bufferSize === 0) {
			const blockSize = Math.round(chunk.sampleRate * 0.02);

			this.bufferSize = blockSize;
			this.streamChunkSize = blockSize;
		}

		return super._buffer(chunk, buffer);
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { sensitivity, frequency } = this.properties;
		const cutoffCoeff = Math.exp((-2 * Math.PI * frequency) / chunk.sampleRate);
		const threshold = 0.1 * (1 - sensitivity);

		while (this.lpState.length < chunk.samples.length) {
			this.lpState.push(0);
		}

		const samples = chunk.samples.map((channel, ch) => {
			const detection = detectPlosive(channel, cutoffCoeff, threshold, this.lpState[ch] ?? 0);

			this.lpState[ch] = detection.lpState;

			if (detection.isPlosive) {
				const fadeLength = Math.min(channel.length, Math.round(chunk.sampleRate * 0.005));

				return removePlosive(channel, cutoffCoeff, detection.lpState, fadeLength);
			}

			return Float32Array.from(channel);
		});

		return { samples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class DePlosiveNode extends TransformNode<DePlosiveProperties> {
	static override readonly moduleName = "De-Plosive";
	static override readonly moduleDescription = "Reduce plosive bursts (p, b, t, d sounds)";
	static override readonly schema = schema;
	static override is(value: unknown): value is DePlosiveNode {
		return TransformNode.is(value) && value.type[2] === "de-plosive";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-plosive"] as const;

	override createStream(): DePlosiveStream {
		return new DePlosiveStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DePlosiveProperties>): DePlosiveNode {
		return new DePlosiveNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function dePlosive(options?: { sensitivity?: number; frequency?: number; id?: string }): DePlosiveNode {
	return new DePlosiveNode({
		sensitivity: options?.sensitivity ?? 0.5,
		frequency: options?.frequency ?? 200,
		id: options?.id,
	});
}
