import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { StreamContext } from "../../node";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "../../transform";

export const schema = z.object({
	before: z.number().min(0).multipleOf(0.001).default(0).describe("Before"),
	after: z.number().min(0).multipleOf(0.001).default(0).describe("After"),
});

export interface PadProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class PadStream extends BufferedTransformStream<PadProperties> {
	private padSampleRate: number;
	private padChannels: number;

	constructor(properties: PadProperties, context: StreamContext) {
		super(properties, context);
		this.padSampleRate = context.sampleRate;
		this.padChannels = context.channels;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { before, after } = this.properties;
		const channels = this.padChannels;

		if (before > 0) {
			const silenceFrames = Math.round(before * this.padSampleRate);
			const frames = buffer.frames;
			const allAudio = await buffer.read(0, frames);

			const padded: Array<Float32Array> = [];

			for (let ch = 0; ch < channels; ch++) {
				const original = allAudio.samples[ch] ?? new Float32Array(0);
				const withPad = new Float32Array(silenceFrames + original.length);
				withPad.set(original, silenceFrames);
				padded.push(withPad);
			}

			await buffer.truncate(0);
			await buffer.append(padded);
		}

		if (after > 0) {
			const silenceFrames = Math.round(after * this.padSampleRate);
			const silence: Array<Float32Array> = [];

			for (let ch = 0; ch < channels; ch++) {
				silence.push(new Float32Array(silenceFrames));
			}

			await buffer.append(silence);
		}
	}
}

export class PadNode extends TransformNode<PadProperties> {
	static override readonly moduleName = "Pad";
	static override readonly moduleDescription = "Add silence to start or end of audio";
	static override readonly schema = schema;
	static override is(value: unknown): value is PadNode {
		return TransformNode.is(value) && value.type[2] === "pad";
	}

	override readonly type = ["async-module", "transform", "pad"] as const;
	override readonly bufferSize = WHOLE_FILE;
	override readonly latency = WHOLE_FILE;

	protected override createStream(context: StreamContext): PadStream {
		return new PadStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<PadProperties>): PadNode {
		return new PadNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function pad(options: { before?: number; after?: number; id?: string }): PadNode {
	const parsed = schema.parse(options);
	return new PadNode({ ...parsed, id: options.id });
}
