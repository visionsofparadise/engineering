import {
	type BiquadCoefficients,
	allPassCoefficients,
	bandPassCoefficients,
	highPassCoefficients,
	highShelfCoefficients,
	lowPassCoefficients,
	lowShelfCoefficients,
	notchCoefficients,
	peakingCoefficients,
} from "@e9g/buffered-audio-nodes-utils";
import type { EqBand } from "..";

export interface BandFilterState {
	x1: number;
	x2: number;
	y1: number;
	y2: number;
}

export function makeFilterState(): BandFilterState {
	return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function bandCoefficients(band: EqBand, sampleRate: number): BiquadCoefficients {
	const { type, frequency, quality, gain } = band;
	const gainDb = gain ?? 0;

	switch (type) {
		case "lowpass":
			return lowPassCoefficients(sampleRate, frequency, quality);
		case "highpass":
			return highPassCoefficients(sampleRate, frequency, quality);
		case "bandpass":
			return bandPassCoefficients(sampleRate, frequency, quality);
		case "peaking":
			return peakingCoefficients(sampleRate, frequency, quality, gainDb);
		case "lowshelf":
			return lowShelfCoefficients(sampleRate, frequency, quality, gainDb);
		case "highshelf":
			return highShelfCoefficients(sampleRate, frequency, quality, gainDb);
		case "notch":
			return notchCoefficients(sampleRate, frequency, quality);
		case "allpass":
			return allPassCoefficients(sampleRate, frequency, quality);
	}
}

/**
 * Process a single sample through one biquad filter with Direct Form I.
 * State is mutated in-place.
 */
export function processSample(sample: number, coeffs: BiquadCoefficients, state: BandFilterState): number {
	const { fb, fa } = coeffs;
	const output = fb[0] * sample + fb[1] * state.x1 + fb[2] * state.x2 - fa[1] * state.y1 - fa[2] * state.y2;

	state.x2 = state.x1;
	state.x1 = sample;
	state.y2 = state.y1;
	state.y1 = output;

	return output;
}
