import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { lowPassCoefficients, zeroPhaseBiquadFilter } from "../../utils/biquad";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(200).describe("Max Click Duration"),
});

export interface DeClickProperties extends z.infer<typeof schema>, TransformModuleProperties {}

/**
 * Detects impulsive noise (clicks, pops) and removes them by momentarily
 * ducking a low-pass filter over the click region. Clicks are high-frequency
 * transients, so the LPF removes the click energy while preserving the
 * underlying speech signal.
 */
export class DeClickModule<P extends DeClickProperties = DeClickProperties> extends TransformModule<P> {
	static override readonly moduleName: string = "De-Click";
	static override readonly moduleDescription = "Remove clicks, pops, and impulse artifacts";
	static override readonly schema: z.ZodType = schema;

	static override is(value: unknown): value is DeClickModule {
		return TransformModule.is(value) && value.type[2] === "de-click";
	}

	override readonly type = ["async-module", "transform", "de-click"];
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private processSampleRate = 44100;

	constructor(properties: AudioChainModuleInput<P>) {
		super({ ...properties, ...schema.encode(properties) });
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
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

	clone(overrides?: Partial<DeClickProperties>): DeClickModule {
		return new DeClickModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deClick(options?: { sensitivity?: number; maxClickDuration?: number; id?: string }): DeClickModule {
	const parsed = schema.parse(options ?? {});
	return new DeClickModule({ ...parsed, id: options?.id });
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

	smoothEnvelopeInPlace(envelope, envSmooth);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = Math.sqrt(envelope[index] ?? 0);
	}

	const sorted = Float32Array.from(envelope);
	sorted.sort();
	const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
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

function smoothEnvelopeInPlace(envelope: Float32Array, windowSize: number): void {
	const halfWin = Math.floor(windowSize / 2);
	const len = envelope.length;
	const source = Float32Array.from(envelope);

	let sum = 0;
	let count = 0;

	for (let index = 0; index < Math.min(halfWin, len); index++) {
		sum += source[index] ?? 0;
		count++;
	}

	for (let index = 0; index < len; index++) {
		const addIdx = index + halfWin;

		if (addIdx < len) {
			sum += source[addIdx] ?? 0;
			count++;
		}

		const removeIdx = index - halfWin - 1;

		if (removeIdx >= 0) {
			sum -= source[removeIdx] ?? 0;
			count--;
		}

		envelope[index] = sum / Math.max(count, 1);
	}
}
