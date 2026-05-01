/**
 * Secant-method iteration on `boost` (the design-doc's `B`) to hit a
 * target integrated LUFS for the loudnessCurve node's learn pass.
 *
 * Per design-loudness-curve §"Iteration to hit target loudness".
 *
 * Each attempt:
 *   1. Build LUT from current `boost`, fixed `posParams` / `negParams`.
 *   2. Stream `buffer.iterate(CHUNK_FRAMES)` chunks; per chunk, apply
 *      the LUT into a per-channel scratch buffer (allocated once at
 *      the top of the attempt and reused) and push the transformed
 *      chunk into a fresh {@link IntegratedLufsAccumulator}.
 *   3. Finalize the accumulator to get the attempt's integrated LUFS.
 *   4. Record (boost, outputLUFS) and either converge or step.
 *
 * Constant memory in source duration: each attempt walks the buffer
 * via `buffer.iterate`, never reading the whole source into RAM, and
 * the per-channel scratch buffers reset between iterations.
 *
 * Stepping (unchanged from the prior whole-buffer implementation):
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
import type { CurveParams } from "./curve";
import { buildLUT, lookupLUT, type LUT } from "./lut";

/**
 * Streaming chunk size — kept in sync with `measurement.ts`. One
 * second's worth of frames at 44.1 kHz; cheap per-chunk allocation
 * with negligible per-iteration overhead.
 */
const CHUNK_FRAMES = 44100;

const DEFAULT_POINT_COUNT_TARGET = 512;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TOLERANCE_LUFS_DB = 0.5;

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
	/**
	 * Linear-amplitude gate threshold. Samples with `|x| < floorLinear`
	 * pass through the LUT step unchanged (matching the final-apply
	 * behaviour) so the per-attempt LUFS measurement is consistent with
	 * what the final apply will produce. The LUFS measurement itself is
	 * NOT gated by this — BS.1770 measures the whole signal. Default
	 * `0` (no gating) for callers that don't need a floor.
	 */
	floorLinear?: number;
	pointCountTarget?: number;
	maxAttempts?: number;
	toleranceLUFSdB?: number;
	chunkFrames?: number;
}

/**
 * Run the secant iteration on `boost` until `|outputLUFS − targetLUFS|`
 * is within tolerance or `maxAttempts` is exhausted. Returns the best
 * attempt's boost (closest LUFS) plus the full attempt history for
 * caller diagnostics.
 *
 * Streams the source via `buffer.iterate` once per attempt — the buffer
 * must be re-iterable. Both `MemoryChunkBuffer` and `FileChunkBuffer`
 * satisfy this (their `iterate` walks via `read(offset, frames)` from
 * 0 each call, so re-iteration produces identical chunks).
 */
export async function iterateForTarget(args: IterateForTargetArgs): Promise<IterationResult> {
	const {
		buffer,
		sampleRate,
		posParams,
		negParams,
		targetLUFS,
		sourceLUFS,
		floorLinear = 0,
		pointCountTarget = DEFAULT_POINT_COUNT_TARGET,
		maxAttempts = DEFAULT_MAX_ATTEMPTS,
		toleranceLUFSdB = DEFAULT_TOLERANCE_LUFS_DB,
		chunkFrames = CHUNK_FRAMES,
	} = args;

	const channelCount = buffer.channels;

	const targetGapDb = targetLUFS - sourceLUFS;
	const initialBoost = clampBoost((Math.pow(10, targetGapDb / 20) - 1) * 0.5);

	const attempts: Array<IterationAttempt> = [];
	let currentBoost = initialBoost;
	let bestIndex = 0;
	let bestError = Infinity;

	for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
		const lut = buildLUT(posParams, negParams, currentBoost, pointCountTarget);
		const outputLUFS = await measureLufsThroughLut(buffer, sampleRate, channelCount, lut, chunkFrames, floorLinear);

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

/**
 * Stream the buffer through `lut` at base rate (no oversampling — see
 * design §"Iterate at base rate; oversample only for final apply"),
 * pushing each transformed chunk into a fresh
 * {@link IntegratedLufsAccumulator}, and return the finalized LUFS.
 *
 * Allocates one per-channel scratch `Float32Array(chunkFrames)` at the
 * top of the call and reuses it across chunks, resizing only for the
 * (typically smaller) final chunk. This avoids the per-chunk
 * allocation pressure that the original whole-buffer implementation
 * sidestepped by allocating one full-length output array per attempt.
 */
async function measureLufsThroughLut(
	buffer: ChunkBuffer,
	sampleRate: number,
	channelCount: number,
	lut: LUT,
	chunkFrames: number,
	floorLinear: number,
): Promise<number> {
	if (channelCount === 0 || buffer.frames === 0) return -Infinity;

	const accumulator = new IntegratedLufsAccumulator(sampleRate, channelCount);
	const scratch: Array<Float32Array> = [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		scratch.push(new Float32Array(chunkFrames));
	}

	for await (const chunk of buffer.iterate(chunkFrames)) {
		const inputChannels = chunk.samples;
		const inputFrames = inputChannels[0]?.length ?? 0;

		if (inputFrames === 0) continue;

		// Resize scratch (down) for the final short chunk so the
		// accumulator only sees `inputFrames` valid samples per channel.
		const transformed: Array<Float32Array> = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const sourceChannel = inputChannels[channelIndex];
			const reusable = scratch[channelIndex];

			let outputChannel: Float32Array;

			if (reusable?.length === inputFrames) {
				outputChannel = reusable;
			} else {
				outputChannel = new Float32Array(inputFrames);
				scratch[channelIndex] = outputChannel;
			}

			if (sourceChannel === undefined) {
				outputChannel.fill(0);
			} else {
				// Gate at the floor — below-floor samples pass through, the
				// rest go through the LUT. Same per-sample-magnitude rule as
				// the final apply (which applies it inside the 4× oversample
				// callback); here it's at base rate. Keeps the iteration's
				// LUFS measurement consistent with what the final apply will
				// produce (modulo the documented ~0.3 dB base-rate vs 4× bias).
				for (let frameIndex = 0; frameIndex < inputFrames; frameIndex++) {
					const sample = sourceChannel[frameIndex] ?? 0;

					outputChannel[frameIndex] = (sample < 0 ? -sample : sample) < floorLinear ? sample : lookupLUT(lut, sample);
				}
			}

			transformed.push(outputChannel);
		}

		accumulator.push(transformed, inputFrames);
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
