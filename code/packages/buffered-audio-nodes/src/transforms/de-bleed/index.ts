import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { StreamContext } from "../../node";
import { readToBuffer } from "../../utils/read-to-buffer";
import { replaceChannel } from "../../utils/replace-channel";
import { nlmsAdaptiveFilter } from "./utils/nlms";

export const schema = z.object({
	referencePath: z.string().default("").describe("Reference Path"),
	filterLength: z.number().min(64).max(8192).multipleOf(64).default(1024).describe("Filter Length"),
	stepSize: z.number().min(0.001).max(1).multipleOf(0.001).default(0.1).describe("Step Size"),
});

export interface DeBleedProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class DeBleedStream extends BufferedTransformStream<DeBleedProperties> {
	private referenceSignal!: Float32Array;

	override async _setup(_context: StreamContext): Promise<void> {
		const { buffer: refBuffer } = await readToBuffer(this.properties.referencePath);
		const chunk = await refBuffer.read(0, refBuffer.frames);
		const channel = chunk.samples[0];

		this.referenceSignal = channel ? Float32Array.from(channel) : new Float32Array(0);
		await refBuffer.close();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;
		const { filterLength, stepSize } = this.properties;
		const reference = this.referenceSignal;

		const output = new Float32Array(frames);

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			output.fill(0);
			nlmsAdaptiveFilter(channel, reference, filterLength, stepSize, output);

			await buffer.write(0, replaceChannel(chunk, ch, output, channels));
		}
	}
}

export class DeBleedNode extends TransformNode<DeBleedProperties> {
	static override readonly moduleName = "De-Bleed";
	static override readonly moduleDescription = "Reduce microphone bleed between channels";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeBleedNode {
		return TransformNode.is(value) && value.type[2] === "de-bleed";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-bleed"] as const;

	constructor(properties: DeBleedProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): DeBleedStream {
		return new DeBleedStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeBleedProperties>): DeBleedNode {
		return new DeBleedNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deBleed(
	referencePath: string,
	options?: {
		filterLength?: number;
		stepSize?: number;
		id?: string;
	},
): DeBleedNode {
	return new DeBleedNode({
		referencePath,
		filterLength: options?.filterLength ?? 1024,
		stepSize: options?.stepSize ?? 0.1,
		id: options?.id,
	});
}
