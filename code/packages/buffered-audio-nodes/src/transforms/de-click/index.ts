import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { BufferedAudioNodeInput } from "../../node";
import { lowPassCoefficients, zeroPhaseBiquadFilter } from "../../utils/biquad";
import { detectClickMask, buildBlendEnvelope } from "./utils/click-detection";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(200).describe("Max Click Duration"),
});

export interface DeClickProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class DeClickStream extends BufferedTransformStream<DeClickProperties> {
	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;
		const sampleRate = this.sampleRate ?? 44100;
		const { sensitivity, maxClickDuration } = this.properties;

		const allAudio = await buffer.read(0, frames);

		const refChannel = allAudio.samples[0];

		if (!refChannel) return;

		const clickMask = detectClickMask(refChannel, sampleRate, sensitivity, maxClickDuration);

		const fadeSamples = Math.round(sampleRate * 0.001);
		const blendEnv = buildBlendEnvelope(clickMask, frames, fadeSamples);

		let hasClicks = false;

		for (let index = 0; index < frames; index++) {
			if ((blendEnv[index] ?? 0) > 0) {
				hasClicks = true;
				break;
			}
		}

		if (!hasClicks) return;

		const lpfCutoff = 2500;
		const lpfCoeffs = lowPassCoefficients(sampleRate, lpfCutoff);

		for (let ch = 0; ch < channels; ch++) {
			const channel = allAudio.samples[ch];

			if (!channel) continue;

			const filtered = Float32Array.from(channel);

			zeroPhaseBiquadFilter(filtered, lpfCoeffs);

			for (let index = 0; index < frames; index++) {
				const blend = blendEnv[index] ?? 0;

				if (blend > 0) {
					channel[index] = (channel[index] ?? 0) * (1 - blend) + (filtered[index] ?? 0) * blend;
				}
			}
		}

		await buffer.truncate(0);
		await buffer.append(allAudio.samples);
	}
}

/**
 * Detects impulsive noise (clicks, pops) and removes them by momentarily
 * ducking a low-pass filter over the click region. Clicks are high-frequency
 * transients, so the LPF removes the click energy while preserving the
 * underlying speech signal.
 */
export class DeClickNode<P extends DeClickProperties = DeClickProperties> extends TransformNode<P> {
	static override readonly moduleName: string = "De-Click";
	static override readonly moduleDescription = "Remove clicks, pops, and impulse artifacts";
	static override readonly schema: z.ZodType = schema;

	static override is(value: unknown): value is DeClickNode {
		return TransformNode.is(value) && value.type[2] === "de-click";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-click"];

	constructor(properties: BufferedAudioNodeInput<P>) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties, ...schema.encode(properties) });
	}

	override createStream(): DeClickStream {
		return new DeClickStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeClickProperties>): DeClickNode {
		return new DeClickNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deClick(options?: { sensitivity?: number; maxClickDuration?: number; id?: string }): DeClickNode {
	const parsed = schema.parse(options ?? {});

	return new DeClickNode({ ...parsed, id: options?.id });
}

