import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";

// Match the iteration chunk size used elsewhere in the package
// (see `transforms/ffmpeg/utils/process.ts`). One second's worth of
// frames at 44.1 kHz is a sane balance between per-iteration overhead
// and per-chunk allocation pressure.
const CHUNK_FRAMES = 44100;

/**
 * Measure integrated loudness (BS.1770-4 / EBU R128) over a whole-file
 * `ChunkBuffer`. Streams the buffer in `CHUNK_FRAMES`-frame chunks
 * through an {@link IntegratedLufsAccumulator}, holding only one chunk
 * plus the bounded gating state in memory at any time. Constant memory
 * in source duration.
 *
 * Channel weighting defaults to 1.0 per channel (correct for mono and
 * stereo). BS.1770-4 surround weighting (Ls/Rs at 1.41) is not yet
 * supported here; if surround support becomes a requirement, surface a
 * `channelWeights` parameter and forward it through.
 *
 * Returns `-Infinity` for silent / sub-block-length signals — callers
 * must treat this as a no-op gain (the linear-shift target is undefined
 * when the input has no measurable loudness).
 */
export async function measureIntegratedLufs(buffer: ChunkBuffer, sampleRate: number): Promise<number> {
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
