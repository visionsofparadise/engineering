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

