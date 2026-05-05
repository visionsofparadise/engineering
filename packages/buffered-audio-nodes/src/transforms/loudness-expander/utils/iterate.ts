/**
 * Secant-method iteration on `boost` (the design-doc's `B`) to hit a
 * target integrated LUFS for the loudnessExpander node's learn pass.
 *
 * Per design-loudness-expander §"Iteration to hit target loudness",
 * §"Smoothing — bidirectional IIR on the gain envelope", §"Pipeline
 * shape", and §"Memory at peak". Per design-transforms §"Memory
 * discipline — never load the whole source as a Float32Array": the
 * source itself is streamed via `buffer.iterate(CHUNK_FRAMES)` and never
 * materialised as a full-source-sized Float32Array at this level.
 *
 * Pipeline per attempt:
 *   1. Build a source-sized raw-gain envelope `gRawBuffer[i] = 1 +
 *      boost · shapeAt(detection[i], curveParams)`. The `Float32Array`
 *      backing this envelope is allocated once outside the loop and
 *      overwritten per attempt — its bytes go straight into the
 *      bidirectional smoother on the next line.
 *   2. Smooth: `smoother.applyBidirectional(gRawBuffer)` returns a fresh
 *      `Float32Array` of the same length. The smoother is constructed
 *      once outside the loop; its α is determined by `smoothingMs` /
 *      `sampleRate` (both constant across attempts), and each call to
 *      `applyBidirectional` is self-contained (stateless across
 *      invocations).
 *   3. Stream the source via `buffer.iterate(CHUNK_FRAMES)`. Per chunk:
 *      apply the smoothed gain via `applySmoothedGainChunk` (slicing the
 *      envelope by `chunk.offset`), push the transformed chunk into a
 *      fresh `IntegratedLufsAccumulator`. Finalize → `outputLUFS` for
 *      this attempt.
 *   4. Track `bestBoost`, `bestError`, `bestSmoothedEnvelope`. The
 *      winning smoothed envelope is held by reference so the apply pass
 *      doesn't need to recompute it; losing attempts' smoothed envelopes
 *      go out of scope and are garbage-collected naturally.
 *   5. Step / converge per the shaper's `computeNextBoost` rule
 *      (verbatim).
 *
 * Memory at peak (this module):
 *   - One source-sized raw-gain envelope (`frames × 4 bytes`, reused
 *     across attempts).
 *   - One source-sized winning smoothed envelope (`frames × 4 bytes`,
 *     held by reference for the apply pass).
 *   - During an in-flight attempt, the in-flight smoothed envelope
 *     (`frames × 4 bytes`) is briefly held — but as soon as the next
 *     attempt's `applyBidirectional` returns, the previous losing
 *     envelope is unreferenced and collectable.
 *   - Per-chunk transformed scratch (`chunkFrames × channelCount × 4
 *     bytes`) inside the LUFS measurement walk. Bounded by chunk size.
 *
 * The whole-buffer scaling at this level is therefore O(frames) for the
 * envelopes plus O(chunkFrames × channels) for in-flight scratch — the
 * source channels themselves are never materialised at this level.
 *
 * Stepping (verbatim from the shaper):
 *   - First attempt failed: linear extrapolation from the single point
 *     using `kStep = 0.5` boost-units per LUFS gap.
 *   - Two or more points: classical secant on the most recent two
 *     points, with the slope clamped to a minimum magnitude of 0.05
 *     to prevent runaway when consecutive attempts land at near-
 *     identical LUFS.
 *   - `next_boost` clamped to [0, 100].
 *
 * Initial guess (verbatim from the shaper):
 *   `boost_0 = max(0, (10^(target_gap_dB / 20) − 1) × 0.5)`
 *
 * Convergence: `|outputLUFS − target| < toleranceLUFSdB` returns
 * `converged = true` with `bestBoost` from that attempt and
 * `bestSmoothedEnvelope` set to the smoothed envelope produced for that
 * boost. Exhausting `maxAttempts` returns the boost / smoothed envelope
 * from the attempt with the smallest absolute LUFS error and `converged
 * = false`.
 */

import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { BidirectionalIir, IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { applySmoothedGainChunk } from "./apply";
import { type CurveParams, shapeAt } from "./curve";

/**
 * Max attempts (default; user-tunable via the schema). Matches the
 * shaper's `DEFAULT_MAX_ATTEMPTS` so the two nodes have parity on
 * iteration budget.
 */
export const DEFAULT_MAX_ATTEMPTS = 10;
export const DEFAULT_TOLERANCE_LUFS_DB = 0.5;

/**
 * Streaming chunk size for the per-attempt source walk. One second's
 * worth of frames at 44.1 kHz; matches the convention in
 * `loudness-expander/utils/detect.ts`,
 * `loudness-expander/utils/measurement.ts`, and the shaper /
 * loudness-normalize sub-system. Each iterated chunk allocates
 * `chunkFrames × channelCount × 4 bytes` of transformed scratch —
 * bounded by chunk size, not source size.
 */
export const CHUNK_FRAMES = 44_100;

/**
 * Conservative step coefficient for the post-attempt-1 single-point
 * extrapolation. Half a boost-unit per dB of LUFS gap — under-shoots on
 * purpose so the secant interpolation on attempt 3 has a clean slope to
 * lock onto. Verbatim from the shaper.
 */
const SINGLE_POINT_STEP_COEFFICIENT = 0.5;

/**
 * Minimum slope magnitude (LUFS per boost-unit) for the secant step.
 * Below this, the slope is treated as ±0.05 (preserving sign) to avoid
 * `(target - output) / slope` exploding when consecutive attempts
 * happen to land at near-identical LUFS. Verbatim from the shaper.
 */
const MIN_SECANT_SLOPE = 0.05;

/** Clamp range for `next_boost` to keep the secant from diverging. */
const BOOST_LOWER_BOUND = 0;
const BOOST_UPPER_BOUND = 100;

export interface IterationAttempt {
	boost: number;
	outputLUFS: number;
}

/**
 * The result carries the **winning smoothed envelope** so the apply
 * pass can multiply it onto the source without re-running the
 * bidirectional smoother — saves one `frames`-sized allocation and one
 * full smoothing pass after iteration.
 */
export interface IterationResult {
	bestBoost: number;
	bestSmoothedEnvelope: Float32Array;
	attempts: Array<IterationAttempt>;
	converged: boolean;
}

export interface IterateForTargetArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	detection: Float32Array;
	curveParams: CurveParams;
	smoothingMs: number;
	targetLUFS: number;
	sourceLUFS: number;
	maxAttempts?: number;
	toleranceLUFSdB?: number;
}

/**
 * Run the secant iteration on `boost` until `|outputLUFS − targetLUFS|`
 * is within tolerance or `maxAttempts` is exhausted. Returns the best
 * attempt's boost (closest LUFS), the smoothed envelope produced at
 * that boost (held by reference so the apply pass can reuse it), and
 * the full attempt history for caller diagnostics.
 *
 * Streams the source once per attempt for the LUFS measurement. Never
 * materialises the source as Float32Arrays at this level.
 */
export async function iterateForTarget(iterateArgs: IterateForTargetArgs): Promise<IterationResult> {
	const {
		buffer,
		sampleRate,
		detection,
		curveParams,
		smoothingMs,
		targetLUFS,
		sourceLUFS,
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		toleranceLUFSdB = DEFAULT_TOLERANCE_LUFS_DB,
	} = iterateArgs;

	const channelCount = buffer.channels;
	const frames = buffer.frames;

	if (channelCount === 0 || frames === 0) {
		return {
			bestBoost: 0,
			bestSmoothedEnvelope: new Float32Array(0),
			attempts: [],
			converged: false,
		};
	}

	const targetGapDb = targetLUFS - sourceLUFS;
	const initialBoost = clampBoost((Math.pow(10, targetGapDb / 20) - 1) * 0.5);

	// Reusable raw-gain envelope buffer — overwritten per attempt to
	// avoid per-attempt allocation of a `frames × 4 bytes` array. The
	// smoothed envelope returned by `applyBidirectional` is fresh per
	// attempt (the smoother allocates its own output); the winning one
	// must outlive the loop so we hold it by reference.
	const gRawBuffer = new Float32Array(detection.length);

	// Construct the smoother once outside the loop — α is determined by
	// `smoothingMs` / `sampleRate`, both constant across attempts. Each
	// `applyBidirectional` call is self-contained (no carried state),
	// so the same instance is safe to reuse.
	const smoother = new BidirectionalIir({ smoothingMs, sampleRate });

	const attempts: Array<IterationAttempt> = [];
	let currentBoost = initialBoost;
	let bestBoost = initialBoost;
	let bestSmoothedEnvelope: Float32Array = new Float32Array(0);
	let bestError = Infinity;

	for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
		// Step 1: build the raw-gain envelope in place.
		for (let frameIndex = 0; frameIndex < detection.length; frameIndex++) {
			const detectionValue = detection[frameIndex] ?? 0;

			gRawBuffer[frameIndex] = 1 + currentBoost * shapeAt(detectionValue, curveParams);
		}

		// Step 2: smooth — fresh Float32Array per call.
		const smoothed = smoother.applyBidirectional(gRawBuffer);

		// Step 3: walk source, measure LUFS of `samples × smoothed`.
		const outputLUFS = await measureAttemptLufs({
			buffer,
			sampleRate,
			channelCount,
			frames,
			smoothed,
		});

		attempts.push({ boost: currentBoost, outputLUFS });

		const absoluteError = Math.abs(outputLUFS - targetLUFS);

		if (absoluteError < bestError) {
			bestError = absoluteError;
			bestBoost = currentBoost;
			bestSmoothedEnvelope = smoothed;
		}

		if (absoluteError < toleranceLUFSdB) {
			return {
				bestBoost,
				bestSmoothedEnvelope,
				attempts,
				converged: true,
			};
		}

		if (attemptIndex === maxAttempts - 1) break;

		currentBoost = computeNextBoost(attempts, targetLUFS);
	}

	return {
		bestBoost,
		bestSmoothedEnvelope,
		attempts,
		converged: false,
	};
}

interface MeasureAttemptArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	channelCount: number;
	frames: number;
	smoothed: Float32Array;
}

/**
 * Per-attempt body: stream the source through `applySmoothedGainChunk`
 * (slicing the smoothed envelope by `chunk.offset`) and a fresh
 * {@link IntegratedLufsAccumulator}. Returns the integrated LUFS of the
 * transformed signal.
 *
 * Per-chunk transformed scratch (`chunkFrames × channelCount × 4 bytes`)
 * is the only allocation at this level. Never holds the whole
 * transformed source in memory — chunks are pushed into the LUFS
 * accumulator and discarded.
 */
async function measureAttemptLufs(measureArgs: MeasureAttemptArgs): Promise<number> {
	const { buffer, sampleRate, channelCount, frames, smoothed } = measureArgs;

	if (frames === 0 || channelCount === 0) return -Infinity;

	const accumulator = new IntegratedLufsAccumulator(sampleRate, channelCount);

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const chunkFrames = chunk.samples[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		const transformed = applySmoothedGainChunk({
			chunkSamples: chunk.samples,
			smoothedGain: smoothed,
			offset: chunk.offset,
		});

		accumulator.push(transformed, chunkFrames);
	}

	return accumulator.finalize();
}

/**
 * Step rule (verbatim from the shaper): single-point linear
 * extrapolation for the second attempt, secant interpolation for any
 * later attempt. Always reads the most recent attempt(s) from
 * `attempts`.
 */
function computeNextBoost(attempts: Array<IterationAttempt>, targetLUFS: number): number {
	const last = attempts[attempts.length - 1];

	if (last === undefined) return BOOST_LOWER_BOUND;

	if (attempts.length === 1) {
		const gap = targetLUFS - last.outputLUFS;

		return clampBoost(last.boost + gap * SINGLE_POINT_STEP_COEFFICIENT);
	}

	const previous = attempts[attempts.length - 2];

	if (previous === undefined) return clampBoost(last.boost);

	const boostDelta = last.boost - previous.boost;
	const lufsDelta = last.outputLUFS - previous.outputLUFS;

	let slope = boostDelta === 0 ? 0 : lufsDelta / boostDelta;

	if (!Number.isFinite(slope) || Math.abs(slope) < MIN_SECANT_SLOPE) {
		// Preserve sign when slope is tiny but nonzero; default to positive
		// (loudness usually rises with boost) when slope is exactly zero or
		// non-finite.
		const sign = slope < 0 ? -1 : 1;

		slope = sign * MIN_SECANT_SLOPE;
	}

	const next = last.boost + (targetLUFS - last.outputLUFS) / slope;

	return clampBoost(next);
}

function clampBoost(boost: number): number {
	if (!Number.isFinite(boost)) return BOOST_LOWER_BOUND;
	if (boost < BOOST_LOWER_BOUND) return BOOST_LOWER_BOUND;
	if (boost > BOOST_UPPER_BOUND) return BOOST_UPPER_BOUND;

	return boost;
}
