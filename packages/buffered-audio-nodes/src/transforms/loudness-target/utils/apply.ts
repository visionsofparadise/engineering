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
	/**
	 * Optional caller-provided output slots. When supplied, the helper
	 * writes the per-channel downsampled result into
	 * `output[channelIndex]` instead of allocating a fresh
	 * `Float32Array` per channel. The provided array MUST have one
	 * entry per channel and each entry MUST be sized exactly to that
	 * channel's `chunkSamples[channelIndex].length` — the helper
	 * asserts this and throws on mismatch. Pass `subarray(0,
	 * chunkFrames)` views from a persistent caller-side scratch to
	 * handle variable last-chunk lengths.
	 *
	 * When omitted, behaviour is unchanged: a fresh per-channel array
	 * is allocated and pushed onto a fresh return array (the pre-
	 * Phase-1.2 contract).
	 */
	output?: Array<Float32Array>;
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
	const { chunkSamples, smoothedGain, offset, oversamplers, factor, output: outputOverride } = args;
	const channelCount = chunkSamples.length;

	if (channelCount === 0) return outputOverride ?? [];

	// When the caller provides `output`, validate shape up front so the
	// per-channel writes can assume each slot is the right size. The
	// validation matches the same contract the default path produces
	// (one slot per channel, each sized exactly to that channel's
	// chunk length).
	if (outputOverride !== undefined) {
		if (outputOverride.length !== channelCount) {
			throw new Error(
				`applyOversampledChunk: output array length (${outputOverride.length}) must match channel count (${channelCount})`,
			);
		}

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const expected = chunkSamples[channelIndex]?.length ?? 0;
			const actual = outputOverride[channelIndex]?.length ?? -1;

			if (actual !== expected) {
				throw new Error(
					`applyOversampledChunk: output[${channelIndex}] length (${actual}) must match chunkSamples[${channelIndex}] length (${expected})`,
				);
			}
		}
	}

	const output: Array<Float32Array> = outputOverride ?? [];
	const upsampledOffset = offset * factor;

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const channel = chunkSamples[channelIndex];
		const oversampler = oversamplers[channelIndex];

		if (channel === undefined || oversampler === undefined || channel.length === 0) {
			// Default path: push a fresh zero-filled slot. Override path:
			// the slot already exists and is correctly sized (length 0 or
			// matching `channel.length`); zero-fill it so callers observe
			// the same bytes as the default path would have produced.
			if (outputOverride !== undefined) {
				output[channelIndex]?.fill(0);
			} else {
				output.push(new Float32Array(channel?.length ?? 0));
			}

			continue;
		}

		const upsampled = oversampler.upsample(channel);
		const upLength = upsampled.length;

		for (let upIdx = 0; upIdx < upLength; upIdx++) {
			const gain = smoothedGain[upsampledOffset + upIdx] ?? 0;

			upsampled[upIdx] = (upsampled[upIdx] ?? 0) * gain;
		}

		const downsampled = oversampler.downsample(upsampled);

		if (outputOverride !== undefined) {
			output[channelIndex]?.set(downsampled);
		} else {
			output.push(downsampled);
		}
	}

	return output;
}

export interface ApplyOversampledChunkFromCacheArgs {
	/**
	 * Already-upsampled per-channel chunk samples — read from the
	 * shared upsampled-source cache built once at iteration entry by
	 * `buildSourceUpsampledAndDetectionCaches`. Length per channel is
	 * `chunkFrames × factor`.
	 */
	upsampledChunkSamples: ReadonlyArray<Float32Array>;
	/**
	 * Chunk-aligned slice of the 4×-rate smoothed gain envelope. Length
	 * MUST equal `upsampledChunkSamples[channel].length` for every
	 * channel. The caller (`measureAttemptOutput` / `_unbuffer`) is
	 * responsible for slicing the appropriate window out of the
	 * envelope before calling — this helper performs no offset
	 * arithmetic.
	 */
	smoothedGain: Float32Array;
	/**
	 * One `Oversampler` per channel. ONLY the downsample side is used —
	 * the upsample side was consumed during cache build. Downsamplers
	 * must remain fresh per attempt: their post-multiply input differs
	 * per attempt and corrupts the AA filter state across attempts.
	 */
	downsamplers: ReadonlyArray<Oversampler>;
	factor: OversamplingFactor;
	/**
	 * Optional caller-provided output slots. Same shape contract as
	 * `applyOversampledChunk` (one entry per channel, each sized to
	 * `upsampledChunkSamples[channelIndex].length / factor` — i.e., the
	 * downsampled chunk length).
	 */
	output?: Array<Float32Array>;
}

/**
 * Cache-fed variant of {@link applyOversampledChunk}. Skips the
 * per-attempt upsample step by accepting already-upsampled chunk
 * samples (read from the shared source cache). Per channel:
 *
 *   - Multiply each upsampled sample by the chunk-aligned envelope
 *     slice in-place into a fresh scratch (the cache's samples are
 *     not mutated — they are read by every attempt + by `_unbuffer`).
 *   - `downsamplers[ch].downsample(scratch)` to return to source rate.
 *
 * The downsampler state is persistent ACROSS chunks within a single
 * attempt (AA filter continuity) but MUST be fresh per attempt — see
 * `iterate.ts:measureAttemptOutput` for the per-attempt fresh-set
 * allocation pattern.
 *
 * Memory discipline: the multiply scratch is allocated per channel
 * per chunk at length `upChannel.length`. Same per-chunk allocation
 * footprint as the pre-cache `applyOversampledChunk` path —
 * `Oversampler.downsample` itself allocates the return, which is the
 * caller-visible output. (Hoisting that scratch is out of scope —
 * matches the Block 1 decision on `Oversampler.upsample` / IIR
 * returns.)
 */
export function applyOversampledChunkFromCache(args: ApplyOversampledChunkFromCacheArgs): Array<Float32Array> {
	const { upsampledChunkSamples, smoothedGain, downsamplers, factor, output: outputOverride } = args;
	const channelCount = upsampledChunkSamples.length;

	if (channelCount === 0) return outputOverride ?? [];

	// Validate the override shape up front so the per-channel writes
	// can assume each slot is the right size. The downsampled chunk
	// length is the upsampled chunk length divided by `factor`.
	if (outputOverride !== undefined) {
		if (outputOverride.length !== channelCount) {
			throw new Error(
				`applyOversampledChunkFromCache: output array length (${outputOverride.length}) must match channel count (${channelCount})`,
			);
		}

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const upLength = upsampledChunkSamples[channelIndex]?.length ?? 0;
			const expected = Math.floor(upLength / factor);
			const actual = outputOverride[channelIndex]?.length ?? -1;

			if (actual !== expected) {
				throw new Error(
					`applyOversampledChunkFromCache: output[${channelIndex}] length (${actual}) must equal upsampledChunkSamples[${channelIndex}].length / factor (${expected})`,
				);
			}
		}
	}

	const output: Array<Float32Array> = outputOverride ?? [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const upChannel = upsampledChunkSamples[channelIndex];
		const downsampler = downsamplers[channelIndex];

		if (upChannel === undefined || downsampler === undefined || upChannel.length === 0) {
			const expected = upChannel === undefined ? 0 : Math.floor(upChannel.length / factor);

			if (outputOverride !== undefined) {
				output[channelIndex]?.fill(0);
			} else {
				output.push(new Float32Array(expected));
			}

			continue;
		}

		const upLength = upChannel.length;
		// Multiply into a fresh scratch — the cache's source samples
		// must not be mutated (every attempt + `_unbuffer` reads them).
		// `Oversampler.downsample` consumes the upsampled-length input
		// and returns a fresh source-rate `Float32Array(upLength /
		// factor)`.
		const upsampledProduct = new Float32Array(upLength);

		for (let upIdx = 0; upIdx < upLength; upIdx++) {
			const gain = smoothedGain[upIdx] ?? 0;

			upsampledProduct[upIdx] = (upChannel[upIdx] ?? 0) * gain;
		}

		const downsampled = downsampler.downsample(upsampledProduct);

		if (outputOverride !== undefined) {
			output[channelIndex]?.set(downsampled);
		} else {
			output.push(downsampled);
		}
	}

	return output;
}
