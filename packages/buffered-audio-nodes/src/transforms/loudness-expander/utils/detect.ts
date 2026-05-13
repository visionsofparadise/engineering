import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";

/**
 * Linked detection envelope for the loudnessExpander node.
 *
 * Per design-loudness-expander §"Linked detection — single envelope
 * across channels" and §"Pipeline shape": collapse N channels to a
 * single source-sized envelope `detect[n] = max_c(|x[n, c]|)`. The
 * resulting envelope drives the gain-curve evaluation; the same
 * smoothed gain is then re-used at apply time across every channel,
 * which preserves stereo image (per-channel envelopes drift
 * independently and audibly modulate the image).
 *
 * Memory: a single source-sized `Float32Array` (`frames × 4 bytes`).
 * Source-size, never source-size × channels — matches the
 * design-transforms §"Memory discipline" rule.
 *
 * Walk granularity matches the rest of the loudness-shaper /
 * loudness-normalize sub-system (`44_100` frames per chunk yielded by
 * sequential `ChunkBuffer.read` calls).
 */

/**
 * Iteration chunk size — one second's worth of frames at 44.1 kHz.
 * Matches the convention in `loudness-shaper/utils/measurement.ts` and
 * `loudness-normalize/utils/measurement.ts`. Keep in sync with the same
 * constant declared in this module's neighbours so the detect, learn,
 * and apply walks all use the same granularity.
 */
export const CHUNK_FRAMES = 44_100;

/**
 * Walk a `ChunkBuffer` once and return a source-sized linked detection
 * envelope: `result[n] = max_c(|sample[n, c]|)` across all channels at
 * source-frame index `n`.
 *
 * Pre-allocates a single `Float32Array(buffer.frames)` and writes into
 * it via a running offset (each chunk's frames are appended at the
 * absolute source-frame position the `read(CHUNK_FRAMES)` walk
 * produced). Returns immediately for empty buffers.
 *
 * Per-channel max is computed via a plain inner loop (`let max = 0;
 * if (Math.abs(s) > max) max = Math.abs(s)`) rather than
 * `Math.max(...samples)` spread — the spread is stack-bounded for
 * high channel counts and slower at the inner loop's hot path.
 *
 * Rewinds the buffer's read cursor at entry so this pass starts at
 * frame 0 regardless of where prior reads left the cursor.
 */
export async function computeLinkedDetection(buffer: ChunkBuffer): Promise<Float32Array> {
	const frames = buffer.frames;
	const channelCount = buffer.channels;

	const result = new Float32Array(frames);

	if (frames === 0 || channelCount === 0) return result;

	await buffer.reset();

	let writeOffset = 0;

	for (;;) {
		const chunk = await buffer.read(CHUNK_FRAMES);
		const channels = chunk.samples;
		const chunkFrames = channels[0]?.length ?? 0;

		if (chunkFrames === 0) break;

		for (let frameIndex = 0; frameIndex < chunkFrames; frameIndex++) {
			let max = 0;

			for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
				const sample = channels[channelIndex]?.[frameIndex] ?? 0;
				const absolute = Math.abs(sample);

				if (absolute > max) max = absolute;
			}

			result[writeOffset + frameIndex] = max;
		}

		writeOffset += chunkFrames;

		if (chunkFrames < CHUNK_FRAMES) break;
	}

	return result;
}
