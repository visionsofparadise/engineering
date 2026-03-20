import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import { bandPassCoefficients, biquadFilter } from "../../utils/biquad";
import { smoothEnvelope } from "../../utils/envelope";
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

		// Step 1: Compute sample-level envelope trackers
		const envSmooth = Math.round(sampleRate * 0.01);
		const widebandEnv = new Float32Array(frames);
		const breathBandEnv = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			const sample = channel[index] ?? 0;

			widebandEnv[index] = sample * sample;
		}

		const centerFreq = Math.sqrt(1000 * 6000);
		const quality = centerFreq / (6000 - 1000);
		const { fb, fa } = bandPassCoefficients(sampleRate, centerFreq, quality);
		const breathBandSignal = biquadFilter(channel, fb, fa);

		for (let index = 0; index < frames; index++) {
			breathBandEnv[index] = (breathBandSignal[index] ?? 0) * (breathBandSignal[index] ?? 0);
		}

		const smoothSource = new Float32Array(frames);

		smoothEnvelope(widebandEnv, envSmooth, smoothSource);
		smoothEnvelope(breathBandEnv, envSmooth, smoothSource);

		for (let index = 0; index < frames; index++) {
			widebandEnv[index] = Math.sqrt(widebandEnv[index] ?? 0);
			breathBandEnv[index] = Math.sqrt(breathBandEnv[index] ?? 0);
		}

		// Step 2: Sample-level breath detection
		const speechThreshold = 0.015 * (1 - sensitivity * 0.5);
		const breathThreshold = 0.002 * sensitivity;
		const isBreath = new Uint8Array(frames);

		for (let index = 0; index < frames; index++) {
			const isSpeechGap = (widebandEnv[index] ?? 0) < speechThreshold;
			const isBreathy = (breathBandEnv[index] ?? 0) > breathThreshold;

			isBreath[index] = isSpeechGap && isBreathy ? 1 : 0;
		}

		// Step 3: Find contiguous breath regions with minimum duration
		const minBreathDuration = Math.round(sampleRate * 0.08);
		const regions = findRegions(isBreath, minBreathDuration, frames);

		// Step 4: Extend each region to the true start/end of the breath
		const noiseFloor = speechThreshold * 0.3;

		for (const region of regions) {
			while (region.start > 0 && (widebandEnv[region.start - 1] ?? 0) < speechThreshold) {
				region.start--;
			}

			while (region.end < frames && (widebandEnv[region.end] ?? 0) < speechThreshold) {
				region.end++;
			}

			while (region.start < region.end && (widebandEnv[region.start] ?? 0) < noiseFloor) {
				region.start++;
			}

			while (region.end > region.start && (widebandEnv[region.end - 1] ?? 0) < noiseFloor) {
				region.end--;
			}
		}

		// Step 5: Build gain envelope with smooth crossfades
		const fadeLength = Math.round(sampleRate * 0.015);
		const gainEnvelope = new Float32Array(frames);

		gainEnvelope.fill(1);

		for (const region of regions) {
			for (let index = region.start; index < region.end; index++) {
				gainEnvelope[index] = gainLinear;
			}

			// Fade in at start
			for (let index = 0; index < fadeLength; index++) {
				const pos = region.start - fadeLength + index;

				if (pos >= 0 && pos < frames) {
					const fadeIn = (index + 1) / (fadeLength + 1);

					gainEnvelope[pos] = 1 + (gainLinear - 1) * fadeIn;
				}
			}

			// Fade out at end
			for (let index = 0; index < fadeLength; index++) {
				const pos = region.end + index;

				if (pos >= 0 && pos < frames) {
					const fadeOut = 1 - (index + 1) / (fadeLength + 1);

					gainEnvelope[pos] = 1 + (gainLinear - 1) * fadeOut;
				}
			}
		}

		// Step 6: Apply gain envelope to all channels
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
