/**
 * Peak-respecting two-stage gain envelope for the loudnessTarget node.
 *
 * Per design-loudness-target §"Smoothing — peak-respecting two-stage
 * envelope".
 *
 * Two stages composed under one user parameter `smoothingMs`:
 *
 *   stage 1 (peak-respecting pool):
 *     detectionWindow[n] = max over m in [n - W, n + W] of detection[m]
 *     gWindow[n]         = 10^(gainDbAt(linearToDb(detectionWindow[n])) / 20)
 *
 *   stage 2 (bidirectional smooth):
 *     gSmoothed = BidirectionalIir(gWindow, smoothingMs)
 *
 * Why two stages: the bidirectional IIR alone averages peak-window
 * gain with neighbouring windows, so peak samples receive the body's
 * averaged gain (envelope-averaging artifact). For descending arms
 * peaks get over-amplified; for ascending arms peaks get
 * under-amplified. The peak-respecting pool fixes this — gain in
 * each window is determined by the *loudest sample's* level, taken
 * via window-max on the detection envelope and then mapped through
 * the curve. Bidirectional smoothing then bandlimits the resulting
 * envelope for sideband control.
 *
 * The window-max-of-detection formulation works automatically for
 * both ascending and descending upper-segment curves; no
 * direction flag is needed.
 *
 * Stage 1 uses a deque-based monotonic-queue O(N) sliding-window
 * max (https://en.wikipedia.org/wiki/Sliding_window_minimum). A
 * naive O(N · W) loop would dominate iteration time for typical
 * sources of 1M+ samples.
 *
 * As of Phase 2 of the upsampled-streaming refactor, the loudness-
 * target iteration loop no longer calls this helper directly —
 * detection / max-pool / curve are fused into a chunk-streaming
 * pipeline inside `iterate.ts` against the shared
 * `SlidingWindowMaxStream` utility. This whole-array form remains
 * exported for use as a regression / equivalence reference in the
 * test suite. Phase 4 audits whether to delete it after the 4×
 * upgrade lands.
 */

import type { ChunkBuffer, FileChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { BidirectionalIir, linearToDb, slidingWindowMax } from "@e9g/buffered-audio-nodes-utils";
import { type Anchors, gainDbAt } from "./curve";

/**
 * Half-width (in samples) of the peak-respecting pool window for a
 * given `smoothingMs`. The window is `[n - W, n + W]` (inclusive on
 * both sides; total span `2W + 1`). With the design's `K = W`
 * coupling, the pool half-width matches the IIR time constant in
 * samples. Floor of 1 sample so smoothingMs at the lower bound
 * still produces a non-degenerate window.
 */
export function windowSamplesFromMs(smoothingMs: number, sampleRate: number): number {
	return Math.max(1, Math.round((smoothingMs * sampleRate) / 1000));
}

/**
 * Peak-respecting smoothed gain envelope for the loudnessTarget node.
 *
 * Returns the *linear* gain envelope as a `Float32Array` of the same
 * length as `detection`. The caller multiplies this envelope with
 * each channel's source samples in the apply pass.
 *
 * @param detection - linked detection envelope (`max_c |x[n,c]|`),
 *   linear amplitude, source-rate.
 * @param anchors - curve anchors (floor, pivot, limit, B, peakGainDb).
 * @param smoothingMs - user `smoothing` parameter; range 0.01 .. 200.
 * @param sampleRate - source sample rate (Hz).
 */
export function peakRespectingEnvelope(
	detection: Float32Array,
	anchors: Anchors,
	smoothingMs: number,
	sampleRate: number,
): Float32Array {
	const length = detection.length;

	if (length === 0) return new Float32Array(0);

	const halfWidth = windowSamplesFromMs(smoothingMs, sampleRate);
	const detectionWindow = slidingWindowMax(detection, halfWidth);
	const gWindow = new Float32Array(length);

	for (let sampleIdx = 0; sampleIdx < length; sampleIdx++) {
		const levelDb = linearToDb(detectionWindow[sampleIdx] ?? 0);
		const gainDb = gainDbAt(levelDb, anchors);

		gWindow[sampleIdx] = Math.pow(10, gainDb / 20);
	}

	const iir = new BidirectionalIir({ smoothingMs, sampleRate });

	return iir.applyBidirectional(gWindow);
}

/**
 * Apply the backward HALF of the bidirectional IIR cascade over a
 * source `ChunkBuffer` (the forward-IIR output, in source / forward
 * sample order) into a destination `FileChunkBuffer`, in chunked /
 * disk-backed form.
 *
 * Disk-backed analogue of `BidirectionalIir.applyBackwardPassInPlace`
 * (see `packages/buffered-audio-nodes-utils/src/bidirectional-iir.ts`
 * `applyBackwardPassInPlace` at line 186 — the in-memory whole-array
 * reference this function replaces in the loudness-target iteration
 * path). Per `plan-loudness-target-stream-caching` Phase 3.1.
 *
 * Implementation — "reverse twice + forward IIR" trick. The backward
 * IIR is mathematically equivalent to running the forward IIR over
 * the time-reversed signal and then time-reversing the result back.
 * This re-uses `BidirectionalIir.applyForwardPass` directly (no
 * duplicated IIR math). Per chunk in reverse-chunk order:
 *
 *   1. Read the chunk from `sourceBuffer` at its forward offset.
 *   2. Reverse the chunk samples into a persistent scratch.
 *   3. Apply `applyForwardPass` over the reversed chunk, with state
 *      threaded across reverse iterations.
 *   4. Reverse the result back into a second persistent scratch.
 *   5. Write the forward-ordered result to `destBuffer` at the
 *      chunk's forward offset (`FileChunkBuffer.write` supports out-
 *      of-order writes — verified by reviewer reading
 *      `packages/buffered-audio-nodes-core/src/buffer/file/index.ts`
 *      `write` at lines 192-241).
 *
 * State continuity matches `applyBackwardPassInPlace`'s init rule:
 * the first reverse iteration seeds `state.value = reversed[0]`
 * (which is the last sample of the forward-ordered chunk, i.e.
 * the last sample of the entire buffer — matching the in-memory
 * init from `buffer[buffer.length - 1]`).
 *
 * Caller's responsibility:
 *   - `destBuffer.frames` must be either 0 (fresh / `truncate(0)`'d)
 *     or equal to `sourceBuffer.frames` (already populated from a
 *     previous run). Throws if neither holds.
 *   - When reusing a destination, `truncate(0)` it before this call
 *     so the previous contents do not bleed through; the writes here
 *     re-extend the file from offset 0 upward.
 *
 * @param sourceBuffer - Holds the forward-IIR output in forward
 *   sample order. Read-only here.
 * @param destBuffer - The smoothed-envelope destination. Written
 *   per-chunk in reverse-chunk order via `write(offset, samples)`.
 * @param iir - The bidirectional IIR instance (uses
 *   `applyForwardPass` only — both halves share the same
 *   `alphaBidirectional`).
 * @param chunkSize - Reverse-iteration stride in samples (single-
 *   channel). Typically `CHUNK_FRAMES * OVERSAMPLE_FACTOR`.
 */
export async function applyBackwardPassOverChunkBuffer(args: {
	sourceBuffer: ChunkBuffer;
	destBuffer: FileChunkBuffer;
	iir: BidirectionalIir;
	chunkSize: number;
}): Promise<void> {
	const { sourceBuffer, destBuffer, iir, chunkSize } = args;
	const totalFrames = sourceBuffer.frames;

	if (destBuffer.frames !== 0 && destBuffer.frames !== totalFrames) {
		throw new Error(
			`applyBackwardPassOverChunkBuffer: destBuffer.frames (${destBuffer.frames}) must be 0 or match sourceBuffer.frames (${totalFrames})`,
		);
	}

	if (totalFrames === 0) return;
	if (chunkSize <= 0) {
		throw new Error(`applyBackwardPassOverChunkBuffer: chunkSize must be > 0 (got ${chunkSize})`);
	}

	// Persistent scratch buffers reused across all reverse iterations
	// within this single call. Sized at `chunkSize` (the steady-state
	// reverse stride); the trailing (forward-leading) short chunk uses
	// `.subarray(0, length)` views into these.
	const reversedScratch = new Float32Array(chunkSize);
	const forwardOrderedScratch = new Float32Array(chunkSize);

	const backwardState = { value: 0 };
	let backwardSeeded = false;

	// Walk in reverse-chunk order. The last chunk in forward order
	// (which holds the buffer's final sample) is the first chunk we
	// process here. Walk down by `chunkSize` until the leading short
	// chunk at offset 0 is consumed.
	const lastChunkStart = Math.floor((totalFrames - 1) / chunkSize) * chunkSize;

	for (let offset = lastChunkStart; offset >= 0; offset -= chunkSize) {
		const chunkLength = Math.min(chunkSize, totalFrames - offset);
		const chunk = await sourceBuffer.read(offset, chunkLength);
		const forwardChunk = chunk.samples[0];

		if (forwardChunk === undefined || forwardChunk.length === 0) continue;

		// Reverse-in: copy `forwardChunk` into `reversedScratch` (or a
		// subview thereof) reversed in-place.
		const reversedView = reversedScratch.subarray(0, chunkLength);

		for (let index = 0; index < chunkLength; index++) {
			reversedView[index] = forwardChunk[chunkLength - 1 - index] ?? 0;
		}

		// Seed backward state on the very first reverse iteration to
		// `reversedView[0]` — this is the buffer's final sample in
		// forward order, matching `applyBackwardPassInPlace`'s init
		// rule of `y = buffer[buffer.length - 1]`.
		if (!backwardSeeded) {
			backwardState.value = reversedView[0] ?? 0;
			backwardSeeded = true;
		}

		// Forward IIR over the reversed signal == backward IIR on the
		// original. `applyForwardPass` returns a fresh `Float32Array`
		// (per its current API); copy into the persistent forward-
		// ordered scratch below.
		const filtered = iir.applyForwardPass(reversedView, backwardState);

		// Reverse-out: copy `filtered` back to forward order into
		// `forwardOrderedScratch` (or a subview thereof).
		const forwardOrderedView = forwardOrderedScratch.subarray(0, chunkLength);

		for (let index = 0; index < chunkLength; index++) {
			forwardOrderedView[index] = filtered[chunkLength - 1 - index] ?? 0;
		}

		await destBuffer.write(offset, [forwardOrderedView]);

		if (offset === 0) break;
	}
}

