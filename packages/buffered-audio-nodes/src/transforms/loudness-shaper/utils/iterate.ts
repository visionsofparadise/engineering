/**
 * Secant-method iteration on `boost` (the design-doc's `B`) to hit a
 * target integrated LUFS for the loudnessShaper node's learn pass.
 *
 * Per design-loudness-shaper §"Iteration to hit target loudness". Per
 * design-transforms §"Memory discipline — never load the whole source
 * as a Float32Array": the source is streamed via
 * `buffer.iterate(CHUNK_FRAMES)` and never materialised as a full-
 * source-sized array at this level.
 *
 * Pipeline per attempt:
 *   1. Stream the source via `buffer.iterate(CHUNK_FRAMES)`. Per chunk:
 *      apply the curve at base rate via `applyCurveBaseRateChunk` (per-
 *      sample direct evaluation of `f(x, boost, posParams, negParams)`),
 *      push the transformed chunk into a fresh
 *      `IntegratedLufsAccumulator`. Finalize → `outputLUFS` for this
 *      attempt.
 *   2. Record (boost, outputLUFS) and either converge or step.
 *
 * Memory at peak (this module, per attempt):
 *   - Per-chunk transformed scratch: `chunkFrames × channelCount × 4
 *     bytes`. Bounded by chunk size, not by source size.
 *
 * The whole-buffer scaling is therefore O(1) in the source — the
 * source channels themselves are never materialised at this level.
 *
 * Stepping (unchanged):
 *   - First attempt failed: linear extrapolation from the single point
 *     using `kStep = 0.5` boost-units per LUFS gap.
 *   - Two or more points: classical secant on the most recent two
 *     points, with the slope clamped to a minimum magnitude of 0.05
 *     to prevent runaway when consecutive attempts land at near-
 *     identical LUFS.
 *   - `next_boost` clamped to [0, 100].
 *
 * Initial guess (unchanged):
 *   `boost_0 = max(0, (10^(target_gap_dB / 20) − 1) × 0.5)`
 *
 * Convergence: `|outputLUFS − target| < toleranceLUFSdB` returns
 * `converged = true` with `bestBoost = boost` from that attempt.
 * Exhausting `maxAttempts` returns the boost from the attempt with the
 * smallest absolute LUFS error and `converged = false`.
 */

import type { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { applyCurveBaseRateChunk } from "./apply";
import type { CurveParams } from "./curve";

/**
 * Max attempts: 10 (default; user-tunable via the schema). Raised from 5
 * on 2026-05-05 to support the standalone-shaper workflow where the node
 * is expected to land on target LUFS without a downstream
 * `loudnessNormalize` correction. See design-loudness-shaper §"Tolerance
 * and maxAttempts exposed as user parameters; default attempts raised to 10"
 * (2026-05-05 decision).
 */
const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_TOLERANCE_LUFS_DB = 0.5;

/**
 * Streaming chunk size for the per-attempt source walk. One second's
 * worth of frames at 44.1 kHz; matches the convention in
 * `loudness-normalize/utils/measurement.ts`. Each iterated chunk
 * allocates `chunkFrames × channelCount × 4 bytes` of transformed
 * scratch — bounded by chunk size, not source size.
 */
export const CHUNK_FRAMES = 44_100;

/**
 * Conservative step coefficient for the post-attempt-1 single-point
 * extrapolation. Half a boost-unit per dB of LUFS gap — under-shoots on
 * purpose so the secant interpolation on attempt 3 has a clean slope to
 * lock onto.
 */
const SINGLE_POINT_STEP_COEFFICIENT = 0.5;

/**
 * Minimum slope magnitude (LUFS per boost-unit) for the secant step.
 * Below this, the slope is treated as ±0.05 (preserving sign) to avoid
 * `(target - output) / slope` exploding when consecutive attempts
 * happen to land at near-identical LUFS.
 */
const MIN_SECANT_SLOPE = 0.05;

/** Clamp range for `next_boost` to keep the secant from diverging. */
const BOOST_LOWER_BOUND = 0;
const BOOST_UPPER_BOUND = 100;

export interface IterationAttempt {
	boost: number;
	outputLUFS: number;
}

export interface IterationResult {
	bestBoost: number;
	attempts: Array<IterationAttempt>;
	converged: boolean;
}

export interface IterateForTargetArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	posParams: CurveParams;
	negParams: CurveParams;
	targetLUFS: number;
	sourceLUFS: number;
	maxAttempts?: number;
	toleranceLUFSdB?: number;
}

/**
 * Run the secant iteration on `boost` until `|outputLUFS − targetLUFS|`
 * is within tolerance or `maxAttempts` is exhausted. Returns the best
 * attempt's boost (closest LUFS) plus the full attempt history for
 * caller diagnostics.
 *
 * Streams the source once per attempt. Never materialises the source as
 * Float32Arrays at this level.
 */
export async function iterateForTarget(args: IterateForTargetArgs): Promise<IterationResult> {
	const {
		buffer,
		sampleRate,
		posParams,
		negParams,
		targetLUFS,
		sourceLUFS,
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		toleranceLUFSdB = DEFAULT_TOLERANCE_LUFS_DB,
	} = args;

	const channelCount = buffer.channels;
	const frames = buffer.frames;

	if (channelCount === 0 || frames === 0) {
		return { bestBoost: 0, attempts: [], converged: false };
	}

	const targetGapDb = targetLUFS - sourceLUFS;
	const initialBoost = clampBoost((Math.pow(10, targetGapDb / 20) - 1) * 0.5);

	const attempts: Array<IterationAttempt> = [];
	let currentBoost = initialBoost;
	let bestIndex = 0;
	let bestError = Infinity;

	for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
		const outputLUFS = await measureAttemptLufs({
			buffer,
			sampleRate,
			channelCount,
			frames,
			boost: currentBoost,
			posParams,
			negParams,
		});

		attempts.push({ boost: currentBoost, outputLUFS });

		const absoluteError = Math.abs(outputLUFS - targetLUFS);

		if (absoluteError < bestError) {
			bestError = absoluteError;
			bestIndex = attemptIndex;
		}

		if (absoluteError < toleranceLUFSdB) {
			return {
				bestBoost: currentBoost,
				attempts,
				converged: true,
			};
		}

		if (attemptIndex === maxAttempts - 1) break;

		currentBoost = computeNextBoost(attempts, targetLUFS);
	}

	const best = attempts[bestIndex] ?? { boost: currentBoost, outputLUFS: -Infinity };

	return {
		bestBoost: best.boost,
		attempts,
		converged: false,
	};
}

interface MeasureAttemptArgs {
	buffer: ChunkBuffer;
	sampleRate: number;
	channelCount: number;
	frames: number;
	boost: number;
	posParams: CurveParams;
	negParams: CurveParams;
}

/**
 * Per-attempt body: stream the source through `applyCurveBaseRateChunk`
 * and a fresh {@link IntegratedLufsAccumulator}. Returns the integrated
 * LUFS of the transformed signal.
 *
 * Per-chunk transformed scratch (`chunkFrames × channelCount × 4 bytes`)
 * is the only allocation. Never holds the whole transformed source in
 * memory — chunks are pushed into the LUFS accumulator and discarded.
 */
async function measureAttemptLufs(args: MeasureAttemptArgs): Promise<number> {
	const { buffer, sampleRate, channelCount, frames, boost, posParams, negParams } = args;

	if (frames === 0 || channelCount === 0) return -Infinity;

	const accumulator = new IntegratedLufsAccumulator(sampleRate, channelCount);

	for await (const chunk of buffer.iterate(CHUNK_FRAMES)) {
		const chunkFrames = chunk.samples[0]?.length ?? 0;

		if (chunkFrames === 0) continue;

		const transformed = applyCurveBaseRateChunk({
			chunkSamples: chunk.samples,
			boost,
			posParams,
			negParams,
		});

		accumulator.push(transformed, chunkFrames);
	}

	return accumulator.finalize();
}

/**
 * Step rule: single-point linear extrapolation for the second attempt,
 * secant interpolation for any later attempt. Always reads the most
 * recent attempt(s) from `attempts`.
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
