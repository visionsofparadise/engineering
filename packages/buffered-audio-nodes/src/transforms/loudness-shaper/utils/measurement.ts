import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";

/**
 * Iteration chunk size — one second's worth of frames at 44.1 kHz.
 * Matches the convention in `loudness-normalize/utils/measurement.ts`.
 * Keep in sync with the `CHUNK_FRAMES` constant exported by this
 * module's neighbour `iterate.ts` so the apply pass and learn pass walk
 * the buffer at the same granularity.
 */
const CHUNK_FRAMES = 44100;

/**
 * Result of pass 1 — integrated LUFS plus per-side max(|x|) for use as
 * the upper geometric anchor when `preservePeaks = true`.
 */
export interface SourceMeasurement {
	/** Integrated LUFS (BS.1770-4 / EBU R128). `-Infinity` for silent / sub-block-length signals. */
	lufs: number;
	/** Maximum positive sample value across all channels (`max(x)` for `x > 0`). 0 if no positives. */
	posPeak: number;
	/** Maximum |x| of negative samples across all channels (`max(-x)` for `x < 0`). 0 if no negatives. */
	negPeak: number;
}

/**
 * Measure integrated loudness (BS.1770-4 / EBU R128) and per-side peaks
 * over a whole-file `ChunkBuffer` in one streaming pass.
 *
 * Streams the buffer in `CHUNK_FRAMES`-frame chunks through an
 * {@link IntegratedLufsAccumulator}, holding only one chunk plus the
 * bounded gating state in memory at any time. Per-side max tracking adds
 * one comparison per sample per side — negligible cost. Constant memory
 * in source duration.
 *
 * Per-side peaks (`posPeak`, `negPeak`) are reported separately so the
 * shaper node can build asymmetric `peak` anchors when `warmth > 0`.
 *
 * Returns `lufs = -Infinity` for silent / sub-block-length signals;
 * `posPeak` / `negPeak` are still tracked from raw samples even when
 * BS.1770 measurement returns -∞ (a signal can have non-zero amplitude
 * but be too short to integrate).
 */
export async function measureSourceLufsAndPeaks(buffer: ChunkBuffer, sampleRate: number): Promise<SourceMeasurement> {
	const frames = buffer.frames;
	const channelCount = buffer.channels;

	if (frames === 0 || channelCount === 0) return { lufs: -Infinity, posPeak: 0, negPeak: 0 };

	const accumulator = new IntegratedLufsAccumulator(sampleRate, channelCount);
	let posPeak = 0;
	let negPeak = 0;

	// Rewind read cursor — defensive; this is the first reader after the
	// framework's `_process` call begins.
	await buffer.reset();

	for (;;) {
		const chunk = await buffer.read(CHUNK_FRAMES);
		const channels = chunk.samples;
		const chunkFrames = channels[0]?.length ?? 0;

		if (chunkFrames === 0) break;

		for (const channel of channels) {
			const length = channel.length;

			for (let index = 0; index < length; index++) {
				const sample = channel[index] ?? 0;

				if (sample > posPeak) posPeak = sample;
				else if (sample < 0) {
					const absolute = -sample;

					if (absolute > negPeak) negPeak = absolute;
				}
			}
		}

		accumulator.push(channels, chunkFrames);

		if (chunkFrames < CHUNK_FRAMES) break;
	}

	return { lufs: accumulator.finalize(), posPeak, negPeak };
}
