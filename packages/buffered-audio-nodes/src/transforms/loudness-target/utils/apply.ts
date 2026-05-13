/**
 * Per-chunk apply for the loudnessTarget pipeline.
 *
 * Per the 2026-05-13 base-rate-downstream rewrite
 * (`plan-loudness-target-base-rate-downstream`): the smoothed gain
 * envelope produced by iteration is bandlimited far below base-rate
 * Nyquist (smoothing time constants of 1–10 ms at 48 kHz put the
 * envelope's spectral content three orders of magnitude below Nyquist).
 * Storing and applying it at base rate loses nothing structurally;
 * multiplying `base_source × base_envelope` produces a product
 * bandlimited to base-Nyquist + envelope-bandwidth ≈ base-Nyquist, so
 * NO anti-aliasing filter is required after the multiply — empirically
 * validated, no audible artifacts.
 *
 * Concretely: detection still happens at 4× rate (max-pool captures
 * inter-sample peaks for the curve to see — that's structural), but
 * once the curve and IIR have produced a smoothed gain envelope, every
 * downstream consumer operates at base rate. This module's sole helper
 * is the base-rate multiply that Walk B (`measureAttemptOutput`) and
 * `_unbuffer` use.
 *
 * The pre-rewrite `applyOversampledChunk` / `applyOversampledChunkFromCache`
 * helpers — which upsampled the source per chunk, multiplied at 4×
 * rate, and downsampled — are gone. They were the dominant cost of the
 * iteration loop's apply step and `_unbuffer`'s final pass, and the
 * bandlimiting argument above made the round-trip structurally
 * unnecessary.
 *
 * Memory discipline (per design-transforms §"Memory discipline"): this
 * module never allocates source-sized arrays. Per-chunk allocation for
 * `applyBaseRateChunk` is `chunkFrames × 4 bytes` per channel of output
 * scratch — bounded by chunk size, not source size.
 */

export interface ApplyBaseRateChunkArgs {
	/**
	 * Per-channel base-rate source samples. Length per channel is the
	 * chunk's source-frame count.
	 */
	chunkSamples: ReadonlyArray<Float32Array>;
	/**
	 * Chunk-aligned slice of the BASE-RATE smoothed gain envelope.
	 * Length MUST equal `chunkSamples[channel].length` for every
	 * channel. The caller (`measureAttemptOutput` / `_unbuffer`) is
	 * responsible for slicing the appropriate window out of the
	 * envelope ChunkBuffer before calling — this helper performs no
	 * offset arithmetic.
	 */
	smoothedGain: Float32Array;
	/**
	 * Optional caller-provided output slots. When supplied, the helper
	 * writes the per-channel result into `output[channelIndex]` instead
	 * of allocating a fresh `Float32Array` per channel. The provided
	 * array MUST have one entry per channel and each entry MUST be
	 * sized exactly to that channel's `chunkSamples[channelIndex].length`
	 * — the helper asserts this and throws on mismatch. Pass `subarray(0,
	 * chunkFrames)` views from a persistent caller-side scratch to
	 * handle variable last-chunk lengths.
	 *
	 * When omitted, behaviour is unchanged: a fresh per-channel array
	 * is allocated and pushed onto a fresh return array.
	 */
	output?: Array<Float32Array>;
}

/**
 * Per-chunk base-rate apply. For each channel and each base-rate
 * sample n: `output[ch][n] = chunkSamples[ch][n] × smoothedGain[n]`.
 *
 * The smoothed gain envelope is shared across channels (linked apply
 * — one envelope value per base-rate sample, applied to every
 * channel at that index). No upsample, no downsample, no AA filter:
 * the gain envelope is bandlimited far below base-rate Nyquist by
 * its smoothing time constant, and `source × envelope` introduces
 * no high-frequency content above the source's existing band.
 *
 * Memory: when `output` is omitted, allocates one fresh
 * `Float32Array(chunkFrames)` per channel; when `output` is provided,
 * writes in place into the caller's slots. Bounded by chunk size,
 * not source size.
 */
export function applyBaseRateChunk(args: ApplyBaseRateChunkArgs): Array<Float32Array> {
	const { chunkSamples, smoothedGain, output: outputOverride } = args;
	const channelCount = chunkSamples.length;

	if (channelCount === 0) return outputOverride ?? [];

	// Validate the override shape up front so the per-channel writes
	// can assume each slot is the right size. Base-rate apply has the
	// trivial shape contract: each output slot is sized to its
	// channel's input length.
	if (outputOverride !== undefined) {
		if (outputOverride.length !== channelCount) {
			throw new Error(
				`applyBaseRateChunk: output array length (${outputOverride.length}) must match channel count (${channelCount})`,
			);
		}

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const expected = chunkSamples[channelIndex]?.length ?? 0;
			const actual = outputOverride[channelIndex]?.length ?? -1;

			if (actual !== expected) {
				throw new Error(
					`applyBaseRateChunk: output[${channelIndex}] length (${actual}) must match chunkSamples[${channelIndex}] length (${expected})`,
				);
			}
		}
	}

	const output: Array<Float32Array> = outputOverride ?? [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		const channel = chunkSamples[channelIndex];

		if (channel === undefined || channel.length === 0) {
			if (outputOverride !== undefined) {
				output[channelIndex]?.fill(0);
			} else {
				output.push(new Float32Array(channel?.length ?? 0));
			}

			continue;
		}

		// Base-rate envelope MUST be at least the chunk's length —
		// validate the contract here so a mis-sized slice fails loudly
		// rather than silently zero-filling tail samples via the `?? 0`
		// fallback below.
		if (smoothedGain.length < channel.length) {
			throw new Error(
				`applyBaseRateChunk: smoothedGain length (${smoothedGain.length}) is shorter than chunk length (${channel.length}); caller must slice the envelope to match`,
			);
		}

		const chunkFrames = channel.length;
		const overrideSlot = outputOverride !== undefined ? outputOverride[channelIndex] : undefined;
		const slot = overrideSlot ?? new Float32Array(chunkFrames);

		for (let frameIdx = 0; frameIdx < chunkFrames; frameIdx++) {
			slot[frameIdx] = (channel[frameIdx] ?? 0) * (smoothedGain[frameIdx] ?? 0);
		}

		if (outputOverride === undefined) {
			output.push(slot);
		}
	}

	return output;
}
