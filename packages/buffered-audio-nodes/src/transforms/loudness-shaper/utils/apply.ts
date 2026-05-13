/**
 * Per-chunk base-rate apply for the loudnessShaper learn / iterate
 * pipeline.
 *
 * Per design-loudness-shaper §"Pipeline shape": at base rate the curve
 * is evaluated directly per sample via {@link f}. Per-channel
 * processing — the curve is applied to each channel sample independently
 * using the per-side `posParams` / `negParams`. No envelope, no linked
 * detection.
 *
 * Memory discipline (per design-transforms §"Memory discipline"): this
 * module never allocates source-sized arrays. The caller streams the
 * source via a sequential `chunkBuffer.read(CHUNK_FRAMES)` loop and
 * feeds each chunk through `applyCurveBaseRateChunk` in turn; the
 * per-chunk allocation
 * is `chunkFrames × channelCount × 4 bytes` of fresh output samples.
 *
 * Pipeline per chunk:
 *   1. For each channel sample: pick `posParams` or `negParams` by the
 *      sample's own sign, evaluate `f(x, boost, posParams, negParams)`.
 *   2. Return a fresh `Float32Array[]` (one per channel) sized to the
 *      input chunk's per-channel length.
 */

import type { CurveParams } from "./curve";
import { f } from "./curve";

export interface ApplyCurveBaseRateChunkArgs {
	chunkSamples: ReadonlyArray<Float32Array>;
	boost: number;
	posParams: CurveParams;
	negParams: CurveParams;
}

/**
 * Apply the curve to one chunk's samples at base rate. Per-sample, per-
 * channel: `f(x, boost, posParams, negParams)`. Returns a fresh
 * `Float32Array[]` (one per channel) — input is not mutated.
 */
export function applyCurveBaseRateChunk(args: ApplyCurveBaseRateChunkArgs): Array<Float32Array> {
	const { chunkSamples, boost, posParams, negParams } = args;
	const channelCount = chunkSamples.length;

	if (channelCount === 0) return [];

	const output: Array<Float32Array> = [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const channel = chunkSamples[channelIndex];

		if (channel === undefined) {
			output.push(new Float32Array(0));
			continue;
		}

		const length = channel.length;
		const out = new Float32Array(length);

		for (let frameIndex = 0; frameIndex < length; frameIndex++) {
			const sample = channel[frameIndex] ?? 0;

			out[frameIndex] = f(sample, boost, posParams, negParams);
		}

		output.push(out);
	}

	return output;
}
