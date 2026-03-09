import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export interface DeClickProperties extends TransformModuleProperties {
	readonly sensitivity: number;
	readonly maxClickDuration: number;
}

/**
 * Detects impulsive noise (clicks, pops) and removes them by momentarily
 * ducking a low-pass filter over the click region. Clicks are high-frequency
 * transients, so the LPF removes the click energy while preserving the
 * underlying speech signal.
 */
export class DeClickModule extends TransformModule {
	static override is(value: unknown): value is DeClickModule {
		return TransformModule.is(value) && value.type[2] === "de-click";
	}

	readonly type = ["async-module", "transform", "de-click"] as const;
	readonly properties: DeClickProperties;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private processSampleRate = 44100;

	constructor(properties: AudioChainModuleInput<DeClickProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
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

		// Detect clicks on first channel
		const refChannel = allAudio.samples[0];

		if (!refChannel) return;

		const clickMask = detectClickMask(refChannel, sampleRate, sensitivity, maxClickDuration);

		// Build a per-sample blend envelope: 0 = original, 1 = low-passed
		// Expand click mask with fade margins
		const fadeSamples = Math.round(sampleRate * 0.001); // 1ms fade
		const blendEnv = buildBlendEnvelope(clickMask, frames, fadeSamples);

		// Check if there are any clicks to process
		let hasClicks = false;

		for (let index = 0; index < frames; index++) {
			if ((blendEnv[index] ?? 0) > 0) {
				hasClicks = true;
				break;
			}
		}

		if (!hasClicks) return;

		// Apply per-channel: low-pass filter the whole signal, then blend
		const lpfCutoff = 2500; // Hz — preserves speech fundamentals, removes click energy

		for (let ch = 0; ch < channels; ch++) {
			const channel = allAudio.samples[ch];

			if (!channel) continue;

			// Compute low-passed version using 2nd-order Butterworth
			const filtered = applyLowPass(channel, sampleRate, lpfCutoff);

			// Blend: where blendEnv=1, use filtered; where 0, use original
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

function detectClickMask(signal: Float32Array, sampleRate: number, sensitivity: number, maxClickDuration: number): Uint8Array {
	const mask = new Uint8Array(signal.length);

	// High-pass filter to isolate click energy (> ~4kHz)
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

	// Compute envelope of high-passed signal (rectify + smooth)
	const envSmooth = Math.round(sampleRate * 0.0005); // 0.5ms smoothing
	const envelope = new Float32Array(signal.length);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = (highPassed[index] ?? 0) * (highPassed[index] ?? 0);
	}

	smoothEnvelopeInPlace(envelope, envSmooth);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = Math.sqrt(envelope[index] ?? 0);
	}

	// Adaptive threshold based on median envelope level
	const sorted = Float32Array.from(envelope);
	sorted.sort();
	const median = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
	const threshold = median * (5 + 20 * (1 - sensitivity));

	// Mark click samples
	for (let index = 0; index < signal.length; index++) {
		if ((envelope[index] ?? 0) > threshold) {
			mask[index] = 1;
		}
	}

	// Remove regions longer than maxClickDuration (those are likely speech transients, not clicks)
	let regionStart = -1;

	for (let index = 0; index <= signal.length; index++) {
		const active = index < signal.length && (mask[index] ?? 0) > 0;

		if (active && regionStart === -1) {
			regionStart = index;
		} else if (!active && regionStart !== -1) {
			if (index - regionStart > maxClickDuration) {
				// Too long — not a click, clear it
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

	// Set click regions to 1
	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) > 0) {
			envelope[index] = 1;
		}
	}

	// Add fade-in before each click region and fade-out after
	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) === 0) continue;

		// Find region boundaries
		const start = index;
		let end = index;

		while (end < length && (mask[end] ?? 0) > 0) {
			end++;
		}

		// Fade in before start
		for (let fade = 0; fade < fadeSamples; fade++) {
			const pos = start - fadeSamples + fade;

			if (pos >= 0 && (envelope[pos] ?? 0) < 1) {
				const fadeIn = (fade + 1) / (fadeSamples + 1);
				envelope[pos] = Math.max(envelope[pos] ?? 0, fadeIn);
			}
		}

		// Fade out after end
		for (let fade = 0; fade < fadeSamples; fade++) {
			const pos = end + fade;

			if (pos < length && (envelope[pos] ?? 0) < 1) {
				const fadeOut = 1 - (fade + 1) / (fadeSamples + 1);
				envelope[pos] = Math.max(envelope[pos] ?? 0, fadeOut);
			}
		}

		index = end - 1; // Skip to end of region
	}

	return envelope;
}

function applyLowPass(signal: Float32Array, sampleRate: number, cutoff: number): Float32Array {
	const output = new Float32Array(signal.length);

	// 2nd-order Butterworth low-pass (biquad)
	const w0 = (2 * Math.PI * cutoff) / sampleRate;
	const cosW0 = Math.cos(w0);
	const sinW0 = Math.sin(w0);
	const alpha = sinW0 / Math.SQRT2; // Q = 1/sqrt(2) for Butterworth

	const b0 = (1 - cosW0) / 2;
	const b1 = 1 - cosW0;
	const b2 = (1 - cosW0) / 2;
	const a0 = 1 + alpha;
	const a1 = -2 * cosW0;
	const a2 = 1 - alpha;

	// Normalize
	const nb0 = b0 / a0;
	const nb1 = b1 / a0;
	const nb2 = b2 / a0;
	const na1 = a1 / a0;
	const na2 = a2 / a0;

	let x1 = 0,
		x2 = 0,
		y1 = 0,
		y2 = 0;

	// Forward pass
	for (let index = 0; index < signal.length; index++) {
		const x0 = signal[index] ?? 0;
		const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
		output[index] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}

	// Backward pass for zero-phase filtering (eliminates phase distortion)
	x1 = 0;
	x2 = 0;
	y1 = 0;
	y2 = 0;

	for (let index = signal.length - 1; index >= 0; index--) {
		const x0 = output[index] ?? 0;
		const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
		output[index] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}

	return output;
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

export function deClick(options?: { sensitivity?: number; maxClickDuration?: number; id?: string }): DeClickModule {
	return new DeClickModule({
		sensitivity: options?.sensitivity ?? 0.5,
		maxClickDuration: options?.maxClickDuration ?? 200,
		id: options?.id,
	});
}

export function mouthDeClick(options?: { sensitivity?: number; id?: string }): DeClickModule {
	return new DeClickModule({
		sensitivity: options?.sensitivity ?? 0.7,
		maxClickDuration: 50,
		id: options?.id,
	});
}

export function deCrackle(options?: { sensitivity?: number; id?: string }): DeClickModule {
	return new DeClickModule({
		sensitivity: options?.sensitivity ?? 0.5,
		maxClickDuration: 20,
		id: options?.id,
	});
}
