/**
 * Fused cache-build helper for the loudnessTarget iteration loop.
 *
 * Per `plan-loudness-target-stream-caching.md` §Phase 2 / Design Block 2,
 * two derived signals are pure functions of the source (post-upsample)
 * and do NOT depend on per-attempt parameters (`B`, `peakGainDb`,
 * `limitDb`, `floorDb`, `pivotDb`):
 *
 *   1. The 4×-upsampled per-channel source itself — consumed both by
 *      Walk B's apply pass (during iteration) AND by `_unbuffer`'s
 *      final apply pass.
 *   2. The 4×-rate linked detection envelope after sliding-window max-
 *      pool (`max_c |upChannels[c][k]|` then
 *      `SlidingWindowMaxStream(halfWidth)`) — consumed by Walk A.
 *
 * Both are built ONCE at iteration entry via a single fused walk over
 * the source ChunkBuffer. Per attempt Walk A then only runs curve
 * evaluation + forward IIR, and Walk B only runs multiply + downsample.
 * Across N attempts this eliminates `(N - 1) × channelCount` upsampling
 * passes per walk.
 *
 * Both returned buffers are `FileChunkBuffer`s — they auto-spill to disk
 * above their `DEFAULT_STORAGE_THRESHOLD` so the in-memory footprint
 * stays bounded regardless of source length. The caller owns the
 * lifecycle of both — `close()` on both when they go out of use.
 *
 * The `SlidingWindowMaxStream` runs ONCE during cache build with state
 * continuity across chunks. Its leading-edge defer of `halfWidth`
 * samples is owned by this builder so callers see a fully-populated
 * detection buffer of exact length `frames × OVERSAMPLE_FACTOR`. The
 * final input chunk is signalled with `isFinal === true` so the
 * trailing-edge outputs flush.
 *
 * Memory discipline (per design-transforms §"Memory discipline"): never
 * materialise a source-sized `Float32Array`. The persistent per-chunk
 * scratch is sized at the maximum chunk length, not the source length.
 */

import { FileChunkBuffer, type ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { Oversampler, SlidingWindowMaxStream } from "@e9g/buffered-audio-nodes-utils";
import { CHUNK_FRAMES, OVERSAMPLE_FACTOR } from "./iterate";

export interface SourceUpsampledCaches {
	/**
	 * Per-channel 4×-upsampled source. Shape:
	 * `channelCount × (frames × OVERSAMPLE_FACTOR)`.
	 */
	upsampledSource: FileChunkBuffer;
	/**
	 * Single-channel 4×-rate detection envelope after the peak-respecting
	 * sliding-window max-pool. Shape: `1 × (frames × OVERSAMPLE_FACTOR)`.
	 */
	detectionEnvelope: FileChunkBuffer;
}

export interface BuildSourceUpsampledAndDetectionCachesArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	channelCount: number;
	frames: number;
	halfWidth: number;
}

/**
 * Walk the source ChunkBuffer once and produce two FileChunkBuffers in
 * lockstep:
 *   - `upsampledSource`: per-channel upsampled samples appended in
 *     source order.
 *   - `detectionEnvelope`: post-max-pool detection envelope at 4× rate.
 *
 * Invariants on return:
 *   - `upsampledSource.frames === frames × OVERSAMPLE_FACTOR`
 *   - `upsampledSource.channels === channelCount`
 *   - `detectionEnvelope.frames === frames × OVERSAMPLE_FACTOR`
 *   - `detectionEnvelope.channels === 1`
 *
 * The Oversampler set, SlidingWindowMaxStream, and per-chunk scratch
 * are all local to this function — dropped on return.
 */
export async function buildSourceUpsampledAndDetectionCaches(
	args: BuildSourceUpsampledAndDetectionCachesArgs,
): Promise<SourceUpsampledCaches> {
	const { buffer, sampleRate, channelCount, frames, halfWidth } = args;

	const upsampledTotal = frames * OVERSAMPLE_FACTOR;
	const upsampledSource = new FileChunkBuffer(upsampledTotal, channelCount);
	const detectionEnvelope = new FileChunkBuffer(upsampledTotal, 1);

	if (frames === 0 || channelCount === 0) {
		return { upsampledSource, detectionEnvelope };
	}

	// Fresh per-channel oversamplers for THIS walk only. Biquad state
	// continues across chunks of THIS walk; the array is dropped at
	// function return. MUST NOT be shared with the iteration's per-
	// attempt oversamplers, the stream class's persistent apply set, or
	// the measurement pre-pass oversamplers — those have absorbed
	// different signal histories.
	const oversamplers: Array<Oversampler> = [];

	for (let channelIdx = 0; channelIdx < channelCount; channelIdx++) {
		oversamplers.push(new Oversampler(OVERSAMPLE_FACTOR, sampleRate));
	}

	const slidingWindow = new SlidingWindowMaxStream(halfWidth);
	// Persistent per-chunk scratch sized at the maximum upsampled chunk
	// length. Reused via `.subarray(0, length)` for the variable last-
	// chunk length. Replaces per-chunk `new Float32Array(...)` allocations
	// for the detection signal.
	const detectScratch = new Float32Array(CHUNK_FRAMES * OVERSAMPLE_FACTOR);

	let consumedUpsampledFrames = 0;

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const channels = chunk.samples;
		const chunkFrames = channels[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		const upChunkLength = chunkFrames * OVERSAMPLE_FACTOR;
		// Upsample each channel to 4×.
		const upChannels: Array<Float32Array> = [];

		for (let channelIdx = 0; channelIdx < channels.length; channelIdx++) {
			const channel = channels[channelIdx];
			const oversampler = oversamplers[channelIdx];

			if (channel === undefined || oversampler === undefined) {
				upChannels.push(new Float32Array(upChunkLength));
				continue;
			}

			upChannels.push(oversampler.upsample(channel));
		}

		// Append the per-channel upsampled samples to the source cache.
		await upsampledSource.append(upChannels);

		// 4×-rate linked detection signal: `max_c |upChannels[c][upIdx]|`
		// per upsampled sample. Same fill-loop shape as walk A's pre-
		// refactor code.
		const detectChunk = detectScratch.subarray(0, upChunkLength);

		for (let upIdx = 0; upIdx < upChunkLength; upIdx++) {
			let max = 0;

			for (let channelIdx = 0; channelIdx < upChannels.length; channelIdx++) {
				const upSample = upChannels[channelIdx]?.[upIdx] ?? 0;
				const absolute = Math.abs(upSample);

				if (absolute > max) max = absolute;
			}

			detectChunk[upIdx] = max;
		}

		consumedUpsampledFrames += upChunkLength;

		const isFinal = consumedUpsampledFrames >= upsampledTotal;
		const pooled = slidingWindow.push(detectChunk, isFinal);

		// The leading-edge defer of `halfWidth` samples can produce a
		// zero-length `pooled` on the first chunk(s) until enough input
		// has been ingested. Skip the append in that case — `append`
		// short-circuits on duration 0 anyway, but the explicit guard
		// keeps the contract obvious.
		if (pooled.length > 0) {
			await detectionEnvelope.append([pooled]);
		}
	}

	return { upsampledSource, detectionEnvelope };
}
