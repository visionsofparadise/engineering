import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";

/**
 * Iteration chunk size — one second's worth of frames at 44.1 kHz.
 * Matches the convention in `loudness-normalize/utils/measurement.ts`
 * and `transforms/ffmpeg/utils/process.ts`. Keep in sync with the
 * `CHUNK_FRAMES` constant exported by this module's neighbour
 * `iterate.ts` so the apply pass and learn pass walk the buffer at the
 * same granularity.
 */
const CHUNK_FRAMES = 44100;

/**
 * Measure integrated loudness (BS.1770-4 / EBU R128) over a whole-file
 * `ChunkBuffer`. Streams the buffer in `CHUNK_FRAMES`-frame chunks
 * through an {@link IntegratedLufsAccumulator}, holding only one chunk
 * plus the bounded gating state in memory at any time. Constant memory
 * in source duration.
 *
 * Duplicated from `loudness-normalize/utils/measurement.ts` — sibling
 * transforms should not cross-import. The function is small and the
 * cross-import is the kind of coupling that bites later when one
 * transform needs to evolve its measurement signature without breaking
 * the other.
 *
 * Returns `-Infinity` for silent / sub-block-length signals — callers
 * must treat this as a no-op signal.
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
