import { z } from "zod";
import type { AudioChunk, StreamContext } from "../../node";
import { BufferedTransformStream, TransformNode, type TransformNodeProperties } from "../../transform";
import { readWavSamples } from "../../utils/read-to-buffer";

export const schema = z.object({
	insertPath: z.string().default("").meta({ input: "file", mode: "open", accept: ".wav" }).describe("Insert File Path"),
	insertAt: z.number().min(0).default(0).describe("Insert At (frames)"),
});

export interface SpliceProperties extends z.infer<typeof schema>, TransformNodeProperties {
	readonly channels?: ReadonlyArray<number>;
}

export class SpliceStream extends BufferedTransformStream<SpliceProperties> {
	private insertSamples?: Array<Float32Array>;
	private insertLength = 0;

	private async ensureInsertSamples(): Promise<void> {
		if (this.insertSamples) return;
		const props = this.properties;
		const { samples, sampleRate, channels: fileChannels } = await readWavSamples(props.insertPath);

		if (sampleRate !== this.context.sampleRate) {
			throw new Error(`Splice: insert file sample rate ${sampleRate} does not match stream sample rate ${this.context.sampleRate}`);
		}

		const targetChannels = props.channels;
		const expectedChannels = targetChannels ? targetChannels.length : this.context.channels;

		if (fileChannels !== expectedChannels) {
			throw new Error(`Splice: insert file channels ${fileChannels} does not match expected channels ${expectedChannels}`);
		}

		if (targetChannels) {
			for (const ch of targetChannels) {
				if (ch < 0 || ch >= this.context.channels) {
					throw new Error(`Splice: target channel ${ch} is out of range [0, ${this.context.channels})`);
				}
			}
		}

		this.insertSamples = samples;
		this.insertLength = samples[0]?.length ?? 0;
	}

	override async _unbuffer(chunk: AudioChunk): Promise<AudioChunk> {
		await this.ensureInsertSamples();
		const props = this.properties;
		const chunkStart = chunk.offset;
		const chunkEnd = chunkStart + chunk.duration;
		const insertEnd = props.insertAt + this.insertLength;

		if (chunkEnd <= props.insertAt || chunkStart >= insertEnd) {
			return chunk;
		}

		const samples = chunk.samples.map((channel) => new Float32Array(channel));

		const overlapStart = Math.max(0, props.insertAt - chunkStart);
		const overlapEnd = Math.min(chunk.duration, insertEnd - chunkStart);
		const insertOffset = Math.max(0, chunkStart - props.insertAt);

		const targetChannels = props.channels;

		if (targetChannels) {
			for (let insertCh = 0; insertCh < targetChannels.length; insertCh++) {
				const primaryCh = targetChannels[insertCh];
				if (primaryCh === undefined) continue;
				const channelSamples = samples[primaryCh];
				const insertChannel = this.insertSamples![insertCh];
				if (!channelSamples || !insertChannel) continue;

				for (let frame = overlapStart; frame < overlapEnd; frame++) {
					const insertIndex = insertOffset + frame - overlapStart;
					const insertSample = insertChannel[insertIndex];
					if (insertSample !== undefined) {
						channelSamples[frame] = insertSample;
					}
				}
			}
		} else {
			for (let ch = 0; ch < samples.length; ch++) {
				const channelSamples = samples[ch];
				const insertChannel = this.insertSamples![ch];
				if (!channelSamples || !insertChannel) continue;

				for (let frame = overlapStart; frame < overlapEnd; frame++) {
					const insertIndex = insertOffset + frame - overlapStart;
					const insertSample = insertChannel[insertIndex];
					if (insertSample !== undefined) {
						channelSamples[frame] = insertSample;
					}
				}
			}
		}

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}
}

export class SpliceNode extends TransformNode<SpliceProperties> {
	static override readonly moduleName = "Splice";
	static override readonly moduleDescription = "Replace a region of audio with processed content";
	static override readonly schema = schema;
	static override is(value: unknown): value is SpliceNode {
		return TransformNode.is(value) && value.type[2] === "splice";
	}

	override readonly type = ["async-module", "transform", "splice"] as const;
	override readonly bufferSize = 0;
	override readonly latency = 0;

	protected override createStream(context: StreamContext): SpliceStream {
		return new SpliceStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<SpliceProperties>): SpliceNode {
		return new SpliceNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function splice(insertPath: string, insertAt: number, options?: { channels?: ReadonlyArray<number> }): SpliceNode {
	return new SpliceNode({ insertPath, insertAt, channels: options?.channels });
}
