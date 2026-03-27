import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type ChunkBuffer, type TransformNodeProperties } from "buffered-audio-nodes-core";
import { buildGainEnvelope, computeBreathEnvelopes, expandBreathRegions } from "./utils/envelope";
import { findRegions } from "./utils/regions";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	reduction: z.number().min(-60).max(0).multipleOf(1).default(-12).describe("Reduction"),
	mode: z.enum(["remove", "attenuate"]).default("attenuate").describe("Mode"),
});

export interface BreathControlProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class BreathControlStream extends BufferedTransformStream<BreathControlProperties> {
	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;
		const sampleRate = this.sampleRate ?? 44100;
		const { sensitivity, reduction, mode } = this.properties;

		const gainDb = mode === "remove" ? -96 : reduction;
		const gainLinear = Math.pow(10, gainDb / 20);

		const allAudio = await buffer.read(0, frames);
		const channel = allAudio.samples[0];

		if (!channel) return;

		const { wideband, breathBand } = computeBreathEnvelopes(channel, sampleRate, 1000, 6000);

		const speechThreshold = 0.015 * (1 - sensitivity * 0.5);
		const breathThreshold = 0.002 * sensitivity;
		const isBreath = new Uint8Array(frames);

		for (let index = 0; index < frames; index++) {
			const isSpeechGap = (wideband[index] ?? 0) < speechThreshold;
			const isBreathy = (breathBand[index] ?? 0) > breathThreshold;

			isBreath[index] = isSpeechGap && isBreathy ? 1 : 0;
		}

		const minBreathDuration = Math.round(sampleRate * 0.08);
		const regions = findRegions(isBreath, minBreathDuration, frames);

		expandBreathRegions(regions, wideband, speechThreshold);

		const fadeLength = Math.round(sampleRate * 0.015);
		const gainEnvelope = buildGainEnvelope(regions, frames, fadeLength, fadeLength, gainLinear);

		for (let ch = 0; ch < channels; ch++) {
			const chData = allAudio.samples[ch];

			if (!chData) continue;

			for (let index = 0; index < frames; index++) {
				chData[index] = (chData[index] ?? 0) * (gainEnvelope[index] ?? 1);
			}
		}

		await buffer.truncate(0);
		await buffer.append(allAudio.samples);
	}
}

export class BreathControlNode extends TransformNode<BreathControlProperties> {
	static override readonly moduleName = "Breath Control";
	static override readonly moduleDescription = "Attenuate or remove breath sounds between phrases";
	static override readonly schema = schema;

	static override is(value: unknown): value is BreathControlNode {
		return TransformNode.is(value) && value.type[2] === "breath-control";
	}

	override readonly type = ["buffered-audio-node", "transform", "breath-control"] as const;

	constructor(properties: BreathControlProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): BreathControlStream {
		return new BreathControlStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<BreathControlProperties>): BreathControlNode {
		return new BreathControlNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function breathControl(options?: { sensitivity?: number; reduction?: number; mode?: "remove" | "attenuate"; id?: string }): BreathControlNode {
	return new BreathControlNode({
		sensitivity: options?.sensitivity ?? 0.5,
		reduction: options?.reduction ?? -12,
		mode: options?.mode ?? "attenuate",
		id: options?.id,
	});
}
