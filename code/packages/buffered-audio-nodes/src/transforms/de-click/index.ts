import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { BufferedAudioNodeInput, StreamContext } from "../../node";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "../../transform";
import { lowPassCoefficients, zeroPhaseBiquadFilter } from "../../utils/biquad";
import { smoothEnvelope } from "../../utils/envelope";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(200).describe("Max Click Duration"),
});

export interface DeClickProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class DeClickStream extends BufferedTransformStream<DeClickProperties> {
	private processSampleRate: number;

	constructor(properties: DeClickProperties, context: StreamContext) {
		super(properties, context);
		this.processSampleRate = context.sampleRate;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;
		const sampleRate = this.processSampleRate;
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

	override readonly type = ["async-module", "transform", "de-click"];
	override readonly bufferSize = WHOLE_FILE;
	override readonly latency = WHOLE_FILE;

	constructor(properties: BufferedAudioNodeInput<P>) {
		super({ ...properties, ...schema.encode(properties) });
	}

	protected override createStream(context: StreamContext): DeClickStream {
		return new DeClickStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<DeClickProperties>): DeClickNode {
		return new DeClickNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deClick(options?: { sensitivity?: number; maxClickDuration?: number; id?: string }): DeClickNode {
	const parsed = schema.parse(options ?? {});
	return new DeClickNode({ ...parsed, id: options?.id });
}

function detectClickMask(signal: Float32Array, sampleRate: number, sensitivity: number, maxClickDuration: number): Uint8Array {
	const mask = new Uint8Array(signal.length);

	const hpCutoff = 4000;
	const rc = 1 / (2 * Math.PI * hpCutoff);
	const dt = 1 / sampleRate;
	const alpha = rc / (rc + dt);

	const highPassed = new Float32Array(signal.length);
	let prevSample = 0;
	let prevHP = 0;

	for (let index = 0; index < signal.length; index++) {
		const sample = signal[index] ?? 0;
		highPassed[index] = alpha * (prevHP + sample - prevSample);
		prevSample = sample;
		prevHP = highPassed[index] ?? 0;
	}

	const envSmooth = Math.round(sampleRate * 0.0005);
	const envelope = new Float32Array(signal.length);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = (highPassed[index] ?? 0) * (highPassed[index] ?? 0);
	}

	smoothEnvelope(envelope, envSmooth);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = Math.sqrt(envelope[index] ?? 0);
	}

	const median = approximateMedian(envelope);
	const threshold = median * (5 + 20 * (1 - sensitivity));

	for (let index = 0; index < signal.length; index++) {
		if ((envelope[index] ?? 0) > threshold) {
			mask[index] = 1;
		}
	}

	let regionStart = -1;

	for (let index = 0; index <= signal.length; index++) {
		const active = index < signal.length && (mask[index] ?? 0) > 0;

		if (active && regionStart === -1) {
			regionStart = index;
		} else if (!active && regionStart !== -1) {
			if (index - regionStart > maxClickDuration) {
				for (let clear = regionStart; clear < index; clear++) {
					mask[clear] = 0;
				}
			}

			regionStart = -1;
		}
	}

	return mask;
}

function buildBlendEnvelope(mask: Uint8Array, length: number, fadeSamples: number): Float32Array {
	const envelope = new Float32Array(length);

	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) > 0) {
			envelope[index] = 1;
		}
	}

	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) === 0) continue;

		const start = index;
		let end = index;

		while (end < length && (mask[end] ?? 0) > 0) {
			end++;
		}

		for (let fade = 0; fade < fadeSamples; fade++) {
			const pos = start - fadeSamples + fade;

			if (pos >= 0 && (envelope[pos] ?? 0) < 1) {
				const fadeIn = (fade + 1) / (fadeSamples + 1);
				envelope[pos] = Math.max(envelope[pos] ?? 0, fadeIn);
			}
		}

		for (let fade = 0; fade < fadeSamples; fade++) {
			const pos = end + fade;

			if (pos < length && (envelope[pos] ?? 0) < 1) {
				const fadeOut = 1 - (fade + 1) / (fadeSamples + 1);
				envelope[pos] = Math.max(envelope[pos] ?? 0, fadeOut);
			}
		}

		index = end - 1;
	}

	return envelope;
}

function approximateMedian(values: Float32Array): number {
	const len = values.length;

	if (len === 0) return 0;

	let min = values[0] ?? 0;
	let max = values[0] ?? 0;

	for (let si = 1; si < len; si++) {
		const sample = values[si] ?? 0;
		if (sample < min) min = sample;
		if (sample > max) max = sample;
	}

	if (min === max) return min;

	const numBins = 1024;
	const bins = new Uint32Array(numBins);
	const scale = (numBins - 1) / (max - min);

	for (let si = 0; si < len; si++) {
		const bin = Math.floor(((values[si] ?? 0) - min) * scale);
		bins[bin] = (bins[bin] ?? 0) + 1;
	}

	const target = len >>> 1;
	let count = 0;

	for (let bi = 0; bi < numBins; bi++) {
		count += bins[bi] ?? 0;

		if (count > target) {
			return min + (bi + 0.5) / scale;
		}
	}

	return max;
}

