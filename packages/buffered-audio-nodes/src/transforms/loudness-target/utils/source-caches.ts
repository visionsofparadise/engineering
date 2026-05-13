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
 * Both returned buffers are `ChunkBuffer`s — they lazily spill to disk
 * above the 10 MB scratch threshold so the in-memory footprint stays
 * bounded regardless of source length. The caller owns the lifecycle of
 * both — `close()` on both when they go out of use.
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

import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { Oversampler, SlidingWindowMaxStream } from "@e9g/buffered-audio-nodes-utils";
import { CHUNK_FRAMES, OVERSAMPLE_FACTOR } from "./iterate";

export interface SourceUpsampledCaches {
	/**
	 * Per-channel 4×-upsampled source. Shape:
	 * `channelCount × (frames × OVERSAMPLE_FACTOR)`.
	 */
	upsampledSource: ChunkBuffer;
	/**
	 * Single-channel 4×-rate detection envelope after the peak-respecting
	 * sliding-window max-pool. Shape: `1 × (frames × OVERSAMPLE_FACTOR)`.
	 */
	detectionEnvelope: ChunkBuffer;
}

export interface BuildSourceUpsampledAndDetectionCachesArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	channelCount: number;
	frames: number;
	halfWidth: number;
}

/**
 * Walk the source ChunkBuffer once and produce two ChunkBuffers in
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

	const upsampledSource = new ChunkBuffer();
	const detectionEnvelope = new ChunkBuffer();

	if (frames === 0 || channelCount === 0) {
		return { upsampledSource, detectionEnvelope };
	}

	const upsampledTotal = frames * OVERSAMPLE_FACTOR;
	const sourceBitDepth = buffer.bitDepth;
	const upsampledSampleRate = sampleRate * OVERSAMPLE_FACTOR;

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

	// Rewind read cursor — the framework's `processAndEmit` flow leaves
	// the cursor at end-of-buffer after `_process` completes, but the
	// caller here (loudness-target's iteration) reads the source buffer
	// from frame 0. Cheap and defensive.
	await buffer.reset();

	for (;;) {
		const chunk = await buffer.read(CHUNK_FRAMES);
		const channels = chunk.samples;
		const chunkFrames = channels[0]?.length ?? 0;

		if (chunkFrames === 0) break;

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
		// Sample rate at the upsampled rate; bit depth threaded from the
		// source buffer's captured metadata.
		await upsampledSource.write(upChannels, upsampledSampleRate, sourceBitDepth);

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
		// has been ingested. Skip the write in that case — `write`
		// short-circuits on duration 0 anyway, but the explicit guard
		// keeps the contract obvious.
		if (pooled.length > 0) {
			// Defensive copy: `pooled` is a subview of `slidingWindow`'s
			// internal output buffer and can be overwritten by the next
			// `push`. The buffer's `write` stores a reference into its
			// scratch via `.set(...)` which copies, so this is actually
			// safe — leaving the comment for documentation.
			await detectionEnvelope.write([pooled], upsampledSampleRate, sourceBitDepth);
		}

		if (chunkFrames < CHUNK_FRAMES) break;
	}

	// Force any in-flight write batch to disk so downstream readers
	// (iterate.ts's walk A, walk B, and _unbuffer) see a consistent
	// state. The buffer's read path spans head-scratch / disk / tail-
	// scratch transparently, but flushing makes the contract obvious
	// and avoids surprising the reset-then-read pattern used in
	// iterate.ts.
	await upsampledSource.flushWrites();
	await detectionEnvelope.flushWrites();

	return { upsampledSource, detectionEnvelope };
}
