import { bandPassCoefficients, biquadFilter, smoothEnvelope } from "@e9g/buffered-audio-nodes-utils";
import type { Region } from "./regions";

export interface BreathEnvelopes {
	readonly wideband: Float32Array;
	readonly breathBand: Float32Array;
}

export function computeBreathEnvelopes(
	channel: Float32Array,
	sampleRate: number,
	breathBandLow: number,
	breathBandHigh: number,
): BreathEnvelopes {
	const frames = channel.length;
	const envSmooth = Math.round(sampleRate * 0.01);
	const wideband = new Float32Array(frames);
	const breathBand = new Float32Array(frames);

	for (let index = 0; index < frames; index++) {
		wideband[index] = (channel[index] ?? 0) ** 2;
	}

	const centerFreq = Math.sqrt(breathBandLow * breathBandHigh);
	const quality = centerFreq / (breathBandHigh - breathBandLow);
	const { fb, fa } = bandPassCoefficients(sampleRate, centerFreq, quality);
	const breathBandSignal = biquadFilter(channel, fb, fa);

	for (let index = 0; index < frames; index++) {
		breathBand[index] = (breathBandSignal[index] ?? 0) ** 2;
	}

	const scratch = new Float32Array(frames);

	smoothEnvelope(wideband, envSmooth, scratch);
	smoothEnvelope(breathBand, envSmooth, scratch);

	for (let index = 0; index < frames; index++) {
		wideband[index] = Math.sqrt(wideband[index] ?? 0);
		breathBand[index] = Math.sqrt(breathBand[index] ?? 0);
	}

	return { wideband, breathBand };
}

export function expandBreathRegions(
	regions: Array<Region>,
	widebandEnvelope: Float32Array,
	speechThreshold: number,
): void {
	const frames = widebandEnvelope.length;
	const noiseFloor = speechThreshold * 0.3;

	for (const region of regions) {
		while (region.start > 0 && (widebandEnvelope[region.start - 1] ?? 0) < speechThreshold) {
			region.start--;
		}

		while (region.end < frames && (widebandEnvelope[region.end] ?? 0) < speechThreshold) {
			region.end++;
		}

		while (region.start < region.end && (widebandEnvelope[region.start] ?? 0) < noiseFloor) {
			region.start++;
		}

		while (region.end > region.start && (widebandEnvelope[region.end - 1] ?? 0) < noiseFloor) {
			region.end--;
		}
	}
}

export function buildGainEnvelope(
	regions: ReadonlyArray<Readonly<Region>>,
	length: number,
	fadeInSamples: number,
	fadeOutSamples: number,
	targetGain: number,
): Float32Array {
	const envelope = new Float32Array(length);

	envelope.fill(1);

	for (const region of regions) {
		for (let index = region.start; index < region.end; index++) {
			envelope[index] = targetGain;
		}

		for (let index = 0; index < fadeInSamples; index++) {
			const pos = region.start - fadeInSamples + index;

			if (pos >= 0 && pos < length) {
				const fade = (index + 1) / (fadeInSamples + 1);

				envelope[pos] = 1 + (targetGain - 1) * fade;
			}
		}

		for (let index = 0; index < fadeOutSamples; index++) {
			const pos = region.end + index;

			if (pos >= 0 && pos < length) {
				const fade = 1 - (index + 1) / (fadeOutSamples + 1);

				envelope[pos] = 1 + (targetGain - 1) * fade;
			}
		}
	}

	return envelope;
}
