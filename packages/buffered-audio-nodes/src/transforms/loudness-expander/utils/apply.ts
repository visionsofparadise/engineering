/**
 * Per-chunk apply for the loudnessExpander pipeline.
 *
 * Per design-loudness-expander §"Pipeline shape": at apply time the
 * winning smoothed gain envelope is sliced per chunk and multiplied
 * scalar-wise against each channel's samples. Linked detection means a
 * single envelope is reused across every channel — `smoothedGain[n]`
 * is read once per frame and applied to every channel at that frame
 * index.
 *
 * The expander has no per-sample shape evaluation here (that lives
 * upstream in {@link gRaw}, which feeds the smoother during iteration).
 * Pass-2's apply step is just a scalar multiply, so this module is
 * deliberately thinner than the shaper's `apply.ts`.
 *
 * Memory discipline (per design-transforms §"Memory discipline"): this
 * module never allocates source-sized arrays. The caller streams the
 * source via `chunkBuffer.iterate(CHUNK_FRAMES)` and feeds each chunk
 * through `applySmoothedGainChunk` in turn; the per-chunk allocation
 * is `chunkFrames × channelCount × 4 bytes` of fresh output samples.
 *
 * Pipeline per chunk:
 *   1. For each channel, allocate a fresh `Float32Array` of the
 *      chunk's per-channel frame length.
 *   2. For each frame index, read `smoothedGain[offset + i]` once and
 *      multiply it onto every channel's sample at that index.
 *   3. Return a fresh `Float32Array[]` (one per channel). Input is
 *      `ReadonlyArray` and is never mutated.
 *
 * `offset` is the chunk's absolute source-frame offset into the
 * winning smoothed envelope. Multi-chunk and single-chunk runs produce
 * identical bytes because the slice math uses `offset` (not a running
 * counter on this side).
 */

export interface ApplyChunkArgs {
	chunkSamples: ReadonlyArray<Float32Array>;
	smoothedGain: Float32Array;
	offset: number;
}

/**
 * Apply the smoothed gain envelope to one chunk's samples. Per frame:
 * `output[c][i] = chunkSamples[c][i] * smoothedGain[offset + i]`. The
 * envelope value is read once per frame and reused across all channels
 * (linked detection / linked apply). Returns a fresh `Float32Array[]`
 * (one per channel) — input is not mutated.
 */
export function applySmoothedGainChunk(args: ApplyChunkArgs): Array<Float32Array> {
	const { chunkSamples, smoothedGain, offset } = args;
	const channelCount = chunkSamples.length;

	if (channelCount === 0) return [];

	const firstChannel = chunkSamples[0];
	const frameCount = firstChannel?.length ?? 0;

	if (frameCount === 0) {
		const empties: Array<Float32Array> = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			empties.push(new Float32Array(0));
		}

		return empties;
	}

	const output: Array<Float32Array> = [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		output.push(new Float32Array(frameCount));
	}

	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		const gain = smoothedGain[offset + frameIndex] ?? 0;

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const channel = chunkSamples[channelIndex];
			const sample = channel?.[frameIndex] ?? 0;
			const out = output[channelIndex];

			if (out !== undefined) out[frameIndex] = sample * gain;
		}
	}

	return output;
}
