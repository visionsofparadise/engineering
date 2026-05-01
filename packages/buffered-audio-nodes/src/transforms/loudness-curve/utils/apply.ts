/**
 * Base-rate LUT application for the loudnessCurve node's iteration loop.
 *
 * Per design-loudness-curve §"Pipeline shape" / §"Iterate at base rate;
 * oversample only for final apply" — during iteration we apply the LUT
 * to source samples without any oversampling or anti-aliasing filter.
 * The aliasing-induced LUFS bias is acceptable because the secant method
 * only requires monotonicity; the final apply (Phase 4) uses 4× oversampling.
 *
 * Pure waveshaping: each output sample is `lookupLUT(lut, source[i])`.
 * No state, no filtering, no per-channel coupling.
 */

import { type LUT, lookupLUT } from "./lut";

/**
 * Apply `lut` to each sample of each channel at base rate. Returns a
 * fresh `Float32Array[]` with one new array per input channel; input
 * arrays are not mutated.
 */
export function applyLUTBaseRate(source: ReadonlyArray<Float32Array>, lut: LUT): Array<Float32Array> {
	const output: Array<Float32Array> = [];

	for (let channelIndex = 0; channelIndex < source.length; channelIndex++) {
		const channel = source[channelIndex];

		if (channel === undefined) {
			output.push(new Float32Array(0));
			continue;
		}

		const out = new Float32Array(channel.length);

		for (let frameIndex = 0; frameIndex < channel.length; frameIndex++) {
			out[frameIndex] = lookupLUT(lut, channel[frameIndex] ?? 0);
		}

		output.push(out);
	}

	return output;
}
