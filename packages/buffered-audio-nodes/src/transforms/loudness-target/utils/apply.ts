/**
 * Per-chunk apply for the loudnessTarget pipeline.
 *
 * Per design-loudness-target §"Pipeline shape": at apply time the
 * winning 4×-upsampled peak-respecting smoothed gain envelope is
 * sliced per chunk and multiplied (at the upsampled rate) against
 * each channel's samples. Linked detection / linked apply means a
 * single envelope is reused across every channel — `smoothedGain[k]`
 * is read once per upsampled sample and applied to every channel at
 * that sample index.
 *
 * One helper in this module (after Phase 4 dropped the native-rate
 * `applySmoothedGainChunk`):
 *   - `applyOversampledChunk`: per-channel oversample → multiply by
 *     gain at each upsampled sample (direct lookup against the 4×-rate
 *     envelope) → downsample. Used by the stream class's `_unbuffer`
 *     for the FINAL apply pass AND by `iterate.ts`'s per-attempt walk
 *     B for the LUFS measurement apply. Distinct sets of `Oversampler`
 *     instances are passed in (the persistent stream-class set vs the
 *     per-walk fresh set inside iteration); they MUST NOT share state.
 *     See `iterate.ts`'s walk-B docstring for the three-way split
 *     between the persistent apply set, walk-A's detection set, and
 *     walk-B's apply set.
 *
 * The gain envelope is 4× upsampled. Per-upsampled-sample lookup is a
 * direct index map: `gainIdx = offset * factor + upIdx` against the
 * 4×-rate envelope. `applyOversampledChunk` requires a `frames *
 * factor`-sized envelope and the chunk's source-rate `offset` (in
 * source frames); the helper does the offset-to-gain-index mapping
 * internally.
 *
 * Memory discipline (per design-transforms §"Memory discipline"): this
 * module never allocates source-sized arrays. Per-chunk allocation
 * for `applyOversampledChunk` is `chunkLen × factor × 4 bytes` of
 * upsampled scratch + `chunkLen × 4 bytes` of downsampled output per
 * channel. Bounded by chunk size, not source size.
 *
 * `offset` is the chunk's absolute source-frame offset (in source
 * frames). The helper multiplies it by `factor` internally to land in
 * the 4×-rate envelope. Multi-chunk and single-chunk runs produce
 * identical bytes because the slice math is offset-based (not a
 * running counter on this side).
 */

import type { Oversampler, OversamplingFactor } from "@e9g/buffered-audio-nodes-utils";

export interface ApplyOversampledChunkArgs {
	chunkSamples: ReadonlyArray<Float32Array>;
	/**
	 * 4×-rate smoothed gain envelope (Phase 4). Size is `frames *
	 * factor`. Per upsampled sample, gain is looked up by direct index:
	 * `smoothedGain[offset * factor + upIdx]` (no zero-order hold —
	 * `offset` is in source-rate frames; the envelope is at the
	 * upsampled rate).
	 */
	smoothedGain: Float32Array;
	/** Chunk's source-frame offset into the source. Multiplied by `factor` internally to land in the 4×-rate envelope. */
	offset: number;
	/**
	 * One `Oversampler` per channel. State carries across chunks within
	 * a single apply pass (whether that's the stream-class persistent
	 * set or a per-walk fresh set inside iteration). Distinct apply
	 * passes MUST use distinct oversampler sets — sharing biquad state
	 * across walks corrupts results.
	 */
	oversamplers: ReadonlyArray<Oversampler>;
	factor: OversamplingFactor;
}

/**
 * Per-chunk final apply: for each channel, run upsample → per-
 * upsampled-sample multiply by the 4×-rate gain envelope → downsample.
 * Returns a fresh `Float32Array[]` (one per channel) sized to the
 * input chunk's per-channel length.
 *
 * The oversampler instances are persistent across chunks (their biquad
 * states carry the AA filter continuity), so multi-chunk runs match
 * the single-chunk path within float-rounding tolerance.
 *
 * Index math: source-rate chunk frame `f` maps to upsampled samples
 * `[f * factor, (f + 1) * factor)`. The chunk's `offset` is in source-
 * rate frames; so the upsampled gain index for in-chunk upsampled
 * sample `upIdx` is `offset * factor + upIdx`. The helper expects
 * `smoothedGain.length >= (offset + chunkFrames) * factor` — the
 * caller (iteration walk B / `_unbuffer`) is responsible for sizing.
 *
 * At `factor === 1` the oversampler is a pass-through (per
 * `oversample.ts` semantics) and the envelope is consumed at native
 * rate (`smoothedGain.length === frames`).
 */
export function applyOversampledChunk(args: ApplyOversampledChunkArgs): Array<Float32Array> {
	const { chunkSamples, smoothedGain, offset, oversamplers, factor } = args;
	const channelCount = chunkSamples.length;

	if (channelCount === 0) return [];

	const output: Array<Float32Array> = [];
	const upsampledOffset = offset * factor;

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const channel = chunkSamples[channelIndex];
		const oversampler = oversamplers[channelIndex];

		if (channel === undefined || oversampler === undefined || channel.length === 0) {
			output.push(new Float32Array(channel?.length ?? 0));
			continue;
		}

		const upsampled = oversampler.upsample(channel);
		const upLength = upsampled.length;

		for (let upIdx = 0; upIdx < upLength; upIdx++) {
			const gain = smoothedGain[upsampledOffset + upIdx] ?? 0;

			upsampled[upIdx] = (upsampled[upIdx] ?? 0) * gain;
		}

		const downsampled = oversampler.downsample(upsampled);

		output.push(downsampled);
	}

	return output;
}
