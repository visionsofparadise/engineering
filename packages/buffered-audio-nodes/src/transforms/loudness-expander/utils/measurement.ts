import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";

/**
 * Source-LUFS measurement for the loudnessExpander node.
 *
 * Per design-loudness-expander §"Two-pass node structure" and §"No peak
 * handling": the expander has no peak anchor, so the learn pass measures
 * integrated LUFS only — there is no per-side peak tracking here (unlike
 * the shaper's `measureSourceLufsAndPeaks`, which surfaces peaks for the
 * shaper's `preservePeaks` upper-anchor logic). Functionally identical to
 * `loudness-normalize/utils/measurement.ts` aside from the export name.
 *
 * Walk granularity matches the rest of the loudness-shaper /
 * loudness-normalize sub-system (`44_100` frames per chunk yielded by
 * `ChunkBuffer.iterate`).
 */

/**
 * Iteration chunk size — one second's worth of frames at 44.1 kHz.
 * Matches the convention in `loudness-shaper/utils/measurement.ts` and
 * `loudness-normalize/utils/measurement.ts`. Re-declared locally
 * (matching the shaper's pattern of each measurement / iterate file
 * owning its own constant) so this module doesn't introduce a cross-file
 * coupling for a single integer.
 */
const CHUNK_FRAMES = 44_100;

/**
 * Measure integrated loudness (BS.1770-4 / EBU R128) over a whole-file
 * `ChunkBuffer`. Streams the buffer in `CHUNK_FRAMES`-frame chunks
 * through an {@link IntegratedLufsAccumulator}, holding only one chunk
 * plus the bounded gating state in memory at any time. Constant memory
 * in source duration.
 *
 * Channel weighting defaults to 1.0 per channel (correct for mono and
 * stereo). Surround weighting is not handled here.
 *
 * Returns `-Infinity` for silent / sub-block-length signals (BS.1770
 * gating fails). The expander's stream class treats this as a
 * pass-through bail signal — there is no defined linear-shift target
 * when the source has no measurable loudness.
 */
export async function measureSourceLufs(buffer: ChunkBuffer, sampleRate: number): Promise<number> {
	const frames = buffer.frames;
	const channelCount = buffer.channels;

	if (frames === 0 || channelCount === 0) return -Infinity;

	const accumulator = new IntegratedLufsAccumulator(sampleRate, channelCount);

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const chunkFrames = chunk.samples[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		accumulator.push(chunk.samples, chunkFrames);
	}

	return accumulator.finalize();
}
