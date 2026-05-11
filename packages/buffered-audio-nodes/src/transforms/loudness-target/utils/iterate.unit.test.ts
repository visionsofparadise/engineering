import { MemoryChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { LoudnessAccumulator, TruePeakAccumulator, linearToDb } from "@e9g/buffered-audio-nodes-utils";
import { describe, expect, it } from "vitest";
import { OVERSAMPLE_FACTOR, iterateForTargets } from "./iterate";

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 8;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;

/**
 * Wrap per-channel synthetic arrays in a `MemoryChunkBuffer`. Mirrors
 * the helper from `loudness-expander/utils/iterate.unit.test.ts`.
 */
async function makeBufferFromChannels(channels: ReadonlyArray<Float32Array>): Promise<MemoryChunkBuffer> {
	const buffer = new MemoryChunkBuffer(Infinity, channels.length);

	await buffer.append(channels.map((channel) => new Float32Array(channel)), SAMPLE_RATE, 32);

	return buffer;
}

/** LCG (numerical-recipes constants) for deterministic noise. */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

		return state / 0x80_00_00_00 - 1;
	};
}

/**
 * Synthetic source: 220 Hz sine plus shaped noise. With `dipDepth < 1`
 * the source has a 1-second-period envelope (alternating amplitude
 * 1 / `dipDepth`) so multiple short-term blocks see different levels
 * and LRA accumulates above zero.
 *
 * Note: the plan's nominal "sine -22 LUFS, peak -3 dBFS" pair isn't
 * realisable with a pure sine (sine LUFS ≈ -6 dB below dBTP). The
 * test source instead lands at a body LUFS comfortably below the
 * test's `pivotDb` so the iteration's slope on `B → outputLufs` is
 * well-conditioned.
 */
function makeSyntheticSource(seed: number, amplitude: number, dipDepth: number): Array<Float32Array> {
	const channel = new Float32Array(FRAME_COUNT);
	const rand = makeLcg(seed);
	const angularStep = (2 * Math.PI * 220) / SAMPLE_RATE;

	for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex++) {
		const sine = Math.sin(angularStep * frameIndex);
		const noise = rand() * 0.05;
		const second = Math.floor(frameIndex / SAMPLE_RATE);
		const envelope = second % 2 === 0 ? 1 : dipDepth;

		channel[frameIndex] = amplitude * envelope * (sine + noise);
	}

	return [channel];
}

interface SourceMetrics {
	integratedLufs: number;
	lra: number;
	truePeakDb: number;
}

function measureSourceMetrics(channels: ReadonlyArray<Float32Array>): SourceMetrics {
	const loudness = new LoudnessAccumulator(SAMPLE_RATE, channels.length);
	const truePeak = new TruePeakAccumulator(SAMPLE_RATE, channels.length);
	const length = channels[0]?.length ?? 0;

	loudness.push(channels, length);
	truePeak.push(channels, length);

	const lr = loudness.finalize();

	return { integratedLufs: lr.integrated, lra: lr.range, truePeakDb: linearToDb(truePeak.finalize()) };
}

describe("iterateForTargets", () => {
	const TEST_TIMEOUT_MS = 120_000;

	it("converges within tolerance on a typical source (1D-on-B)", async () => {
		// Post `plan-loudness-target-percentile-limit`: iteration is 1D
		// on `B`. `limitDb` is set once at entry from the auto-derivation
		// table; with `limitAutoDb = +Infinity` and no override the
		// fallback is `sourcePeakDb` (no limiting). Amplitude 0.1 → body
		// ≈ -25 LUFS, peak ≈ -19 dBTP. Pivot at -10 keeps body well
		// above pivot so body samples sit in the upper segment between
		// B (at pivotDb) and peakGainDb (at peakDb). With
		// `targetTp = undefined` the iterator collapses
		// `effectiveTargetTp = sourcePeakDb`, so `peakGainDb` starts at 0
		// and the upper segment is flat at `B`. Iteration becomes a
		// 1D secant on `B` for LUFS — the canonical convergent case.
		const source = makeSyntheticSource(0xDEAD_BEEF, 0.1, 0.4);
		const metrics = measureSourceMetrics(source);

		expect(Number.isFinite(metrics.integratedLufs)).toBe(true);
		expect(metrics.lra).toBeGreaterThan(0);

		const targetLufs = Math.round((metrics.integratedLufs + 3) * 10) / 10;
		const buffer = await makeBufferFromChannels(source);

		const result = await iterateForTargets({
			buffer,
			sampleRate: SAMPLE_RATE,
			anchorBase: { floorDb: -50, pivotDb: -10 },
			smoothingMs: 1,
			targetLufs,
			targetTp: undefined,
			limitAutoDb: Number.POSITIVE_INFINITY,
			sourceLufs: metrics.integratedLufs,
			sourcePeakDb: metrics.truePeakDb,
			maxAttempts: 10,
			tolerance: 0.5,
			peakTolerance: 0.1,
		});

		expect(result.converged).toBe(true);
		expect(result.attempts.length).toBeLessThanOrEqual(10);
		// 4×-upsampled smoothed gain envelope.
		expect(result.bestSmoothedEnvelope.length).toBe(FRAME_COUNT * OVERSAMPLE_FACTOR);

		const lastAttempt = result.attempts[result.attempts.length - 1];

		expect(lastAttempt).toBeDefined();
		expect(Math.abs(lastAttempt?.lufsErr ?? Infinity)).toBeLessThan(0.5);
		// `limitDb` constant across attempts — every attempt's record carries
		// the same value (the iterator's `currentLimit` at entry).
		const firstLimitDb = result.attempts[0]?.limitDb;

		expect(firstLimitDb).toBeDefined();
		expect(result.bestLimitDb).toBe(firstLimitDb);

		for (const attempt of result.attempts) {
			expect(attempt.limitDb).toBe(firstLimitDb);
		}
	}, TEST_TIMEOUT_MS);

	it("explicit limitAutoDb sets a fixed limit and B converges against it", async () => {
		// New test for `plan-loudness-target-percentile-limit`: pass an
		// explicit finite `limitAutoDb` (simulating what `measureSource`
		// would return for a real source). The iterator's
		// auto-derivation table picks `limitAutoDb` (clamped) as
		// `currentLimit`. `currentLimit` MUST be constant across
		// attempts — `limitDb` no longer iterates.
		//
		// Fixture: same dipped-sine geometry as the canonical convergent
		// test. Pivot at -10 dB; `limitAutoDb` deliberately placed below
		// `sourcePeakDb` (= -19 dBTP) at -10.5 dB (just above
		// `pivotDb + LIMIT_EPSILON_DB` after the iterator's internal
		// clamp). With `targetTp` set explicitly the closed-form
		// `peakGainDb = effectiveTargetTp - limitDb` is non-zero so the
		// curve has a meaningful upper segment.
		const source = makeSyntheticSource(0xFADE_DEAD, 0.1, 0.4);
		const metrics = measureSourceMetrics(source);
		const buffer = await makeBufferFromChannels(source);

		const targetLufs = Math.round((metrics.integratedLufs + 2) * 10) / 10;
		const targetTp = metrics.truePeakDb;
		// `limitAutoDb` placed between pivotDb (-10) and sourcePeakDb
		// (≈ -19). After the iterator's internal `clampLimit`:
		// `pivotDb + LIMIT_EPSILON_DB = -9.99`, `sourcePeakDb ≈ -19`.
		// The feasible window is degenerate (lower > upper because
		// pivot > sourcePeakDb for this fixture); the clamp returns
		// `sourcePeakDb`. To exercise a non-trivial fixed limit, lower
		// `pivotDb` below `sourcePeakDb` so the window is real.
		const pivotDb = -30;
		const limitAutoDb = metrics.truePeakDb - 2; // 2 dB below source peak

		const result = await iterateForTargets({
			buffer,
			sampleRate: SAMPLE_RATE,
			anchorBase: { floorDb: -50, pivotDb },
			smoothingMs: 1,
			targetLufs,
			targetTp,
			limitAutoDb,
			sourceLufs: metrics.integratedLufs,
			sourcePeakDb: metrics.truePeakDb,
			maxAttempts: 10,
			tolerance: 0.5,
			peakTolerance: 0.1,
		});

		// `bestLimitDb` carries the auto-derivation result; must equal
		// the clamped `limitAutoDb` (within the feasible window — at
		// the value we passed since it's between pivot and peak).
		expect(result.bestLimitDb).toBeCloseTo(limitAutoDb, 6);

		// Every attempt's record carries the SAME `limitDb` — this is
		// the load-bearing assertion for the "1D on B" structural
		// change. If a regression re-introduces a `limitDb` iteration
		// axis, this loop fires.
		expect(result.attempts.length).toBeGreaterThan(0);
		for (const attempt of result.attempts) {
			expect(attempt.limitDb).toBeCloseTo(limitAutoDb, 6);
		}

		// `bestSmoothedEnvelope` populated.
		expect(result.bestSmoothedEnvelope.length).toBe(FRAME_COUNT * OVERSAMPLE_FACTOR);
	}, TEST_TIMEOUT_MS);

	it("limitAutoDb = +Infinity falls back to sourcePeakDb (no limit)", async () => {
		// New test for `plan-loudness-target-percentile-limit`: the
		// silent-source / no-post-pivot-samples sentinel from
		// `measureSource` is `Number.POSITIVE_INFINITY`. The iterator's
		// auto-derivation table must treat this as "no usable percentile
		// limit" and fall back to `currentLimit = sourcePeakDb` — the
		// brick-wall branch is then dormant for every sample.
		const source = makeSyntheticSource(0xCAFE_F00D, 0.1, 0.4);
		const metrics = measureSourceMetrics(source);
		const buffer = await makeBufferFromChannels(source);

		const targetLufs = Math.round((metrics.integratedLufs + 3) * 10) / 10;
		const result = await iterateForTargets({
			buffer,
			sampleRate: SAMPLE_RATE,
			anchorBase: { floorDb: -50, pivotDb: -30 },
			smoothingMs: 1,
			targetLufs,
			targetTp: undefined,
			// `+Infinity` sentinel — degenerate histogram, no usable
			// percentile.
			limitAutoDb: Number.POSITIVE_INFINITY,
			sourceLufs: metrics.integratedLufs,
			sourcePeakDb: metrics.truePeakDb,
			maxAttempts: 10,
			tolerance: 0.5,
			peakTolerance: 0.1,
		});

		// Fallback: `currentLimit = sourcePeakDb`. `bestLimitDb` carries
		// this constant.
		expect(result.bestLimitDb).toBe(metrics.truePeakDb);

		// Every attempt records the same `sourcePeakDb` as `limitDb`.
		expect(result.attempts.length).toBeGreaterThan(0);
		for (const attempt of result.attempts) {
			expect(attempt.limitDb).toBe(metrics.truePeakDb);
		}
	}, TEST_TIMEOUT_MS);

	it("infeasible joint targets exhaust maxAttempts and return closest-attempt fallback", async () => {
		// Force non-convergence with `tolerance = 1e-9` and
		// `maxAttempts = 4`. The closest-attempt fallback must return
		// `bestB` from one of the attempts and the minimum joint score
		// across them.
		//
		// Post percentile-limit rewrite: `bestScore` is
		// `sqrt(lufsErr^2 + peakOvershoot^2)` (no LRA term). The
		// `bestB / bestLimitDb` matching collapses — `limitDb` is
		// constant across attempts, so `bestB` alone is the disambiguator.
		const source = makeSyntheticSource(0xC0FFEE, 0.1, 0.4);
		const metrics = measureSourceMetrics(source);
		const buffer = await makeBufferFromChannels(source);

		const result = await iterateForTargets({
			buffer,
			sampleRate: SAMPLE_RATE,
			anchorBase: { floorDb: -50, pivotDb: -10 },
			smoothingMs: 1,
			targetLufs: -10,
			targetTp: -1,
			limitAutoDb: Number.POSITIVE_INFINITY,
			// Artificial sourceLufs / sourcePeakDb to force the iteration
			// into the "huge body lift, no peak headroom" regime — sourcePeakDb
			// = -10 → peakGainDb = +9.
			sourceLufs: -30,
			sourcePeakDb: -10,
			maxAttempts: 4,
			tolerance: 1e-9,
			// Mirror the LUFS tolerance's extreme tightness on the peak axis
			// so the "force non-convergence" intent extends to the peak
			// convergence check from `plan-loudness-target-tp-iteration`.
			peakTolerance: 1e-9,
		});

		expect(result.converged).toBe(false);
		expect(result.attempts.length).toBe(4);

		// Best `B` must come from one of the recorded attempts. `limitDb`
		// is constant, so it can't be a disambiguator — match on `boost`.
		const matchedAttempt = result.attempts.find((attempt) => attempt.boost === result.bestB);

		expect(matchedAttempt).toBeDefined();
		expect(result.bestSmoothedEnvelope.length).toBe(FRAME_COUNT * OVERSAMPLE_FACTOR);

		// Best score must be the minimum across all attempts. Score
		// formula post percentile-limit rewrite:
		// `sqrt(lufsErr^2 + peakOvershoot^2)`.
		const minScore = Math.min(
			...result.attempts.map((attempt) =>
				Math.sqrt(attempt.lufsErr * attempt.lufsErr + attempt.peakOvershoot * attempt.peakOvershoot),
			),
		);
		const bestScore = matchedAttempt
			? Math.sqrt(matchedAttempt.lufsErr * matchedAttempt.lufsErr + matchedAttempt.peakOvershoot * matchedAttempt.peakOvershoot)
			: Infinity;

		expect(bestScore).toBeCloseTo(minScore, 6);
	}, TEST_TIMEOUT_MS);

	/**
	 * Phase 4 of `plan-loudness-target-tp-iteration`: focused tests on
	 * the proportional-feedback adjustment of `currentPeakGainDb` per
	 * attempt. Each test sets `targetTp` EXPLICITLY because
	 * `targetTp === undefined` activates the `skipPeak` gate — in that
	 * mode `peakOvershoot` is forced to 0 and the peak axis is inert,
	 * which would make these assertions meaningless.
	 *
	 * Scenarios:
	 *   (a) overshoot triggers backoff — aggressive curve + tight TP
	 *       ceiling drives at least one attempt to back `peakGainDb` off
	 *       its initial closed-form value.
	 *   (b) no overshoot, no backoff — low gain contrast leaves the
	 *       closed-form `peakGainDb` untouched across every attempt
	 *       (strict numeric equality).
	 *   (c) convergence — moderate-contrast fixture reaches
	 *       `converged === true` within `maxAttempts`.
	 *   (d) infeasibility — huge body lift + severe TP ceiling exhausts
	 *       `maxAttempts`; `bestPeakGainDb` respects the `-60` floor.
	 */
	describe("peakGainDb adjustment", () => {
		const TEST_TIMEOUT_MS_INNER = 120_000;

		it("overshoot triggers backoff when targetTp sits below sourcePeakDb on an aggressive curve", async () => {
			const source = makeSyntheticSource(0xBEEF_CAFE, 0.1, 0.4);
			const metrics = measureSourceMetrics(source);
			const buffer = await makeBufferFromChannels(source);

			const targetLufs = Math.round((metrics.integratedLufs + 12) * 10) / 10;
			const targetTp = metrics.truePeakDb - 3;
			const result = await iterateForTargets({
				buffer,
				sampleRate: SAMPLE_RATE,
				anchorBase: { floorDb: -50, pivotDb: -30 },
				smoothingMs: 5,
				targetLufs,
				targetTp,
				limitAutoDb: Number.POSITIVE_INFINITY,
				sourceLufs: metrics.integratedLufs,
				sourcePeakDb: metrics.truePeakDb,
				maxAttempts: 5,
				tolerance: 0.5,
				peakTolerance: 0.1,
			});

			expect(result.attempts.length).toBeGreaterThan(1);

			const initialPeakGainDb = result.attempts[0]?.peakGainDb;

			expect(initialPeakGainDb).toBeDefined();
			// Initial value: closed-form `targetTp - currentLimit`. With
			// `limitAutoDb = +Infinity` and no override, `currentLimit =
			// sourcePeakDb`, so the closed form is `targetTp - sourcePeakDb`.
			expect(initialPeakGainDb).toBeCloseTo(targetTp - metrics.truePeakDb, 6);

			// At least one attempt overshoots `peakTolerance` so the
			// proportional-feedback branch fires.
			const anyOvershoot = result.attempts.some((attempt) => attempt.peakOvershoot > 0.1);

			expect(anyOvershoot).toBe(true);

			// Backoff: some attempt k > 0 has peakGainDb strictly below
			// attempt 0's value. The adjustment is monotonic-downward,
			// so any non-zero adjustment leaves a strict-less-than gap.
			const backoffOccurred = result.attempts.some(
				(attempt, index) => index > 0 && initialPeakGainDb !== undefined && attempt.peakGainDb < initialPeakGainDb,
			);

			expect(backoffOccurred).toBe(true);
		}, TEST_TIMEOUT_MS_INNER);

		it("no overshoot leaves peakGainDb at the closed-form initial value across every attempt", async () => {
			const source = makeSyntheticSource(0x1234_ABCD, 0.1, 0.4);
			const metrics = measureSourceMetrics(source);
			const buffer = await makeBufferFromChannels(source);

			const targetLufs = Math.round((metrics.integratedLufs + 1.5) * 10) / 10;
			const targetTp = metrics.truePeakDb + 2;
			const result = await iterateForTargets({
				buffer,
				sampleRate: SAMPLE_RATE,
				anchorBase: { floorDb: -50, pivotDb: -10 },
				smoothingMs: 1,
				targetLufs,
				targetTp,
				limitAutoDb: Number.POSITIVE_INFINITY,
				sourceLufs: metrics.integratedLufs,
				sourcePeakDb: metrics.truePeakDb,
				maxAttempts: 5,
				tolerance: 0.05,
				peakTolerance: 0.1,
			});

			expect(result.attempts.length).toBeGreaterThan(1);

			const initialPeakGainDb = result.attempts[0]?.peakGainDb;

			expect(initialPeakGainDb).toBeDefined();
			// Closed-form initial: `targetTp - currentLimit` = +2 (since
			// `targetTp = sourcePeakDb + 2` and `currentLimit =
			// sourcePeakDb` under the `limitAutoDb = +Infinity` fallback).
			expect(initialPeakGainDb).toBeCloseTo(2, 6);

			// No overshoot on any attempt.
			for (const attempt of result.attempts) {
				expect(attempt.peakOvershoot).toBeLessThanOrEqual(0.1);
			}

			// peakGainDb unchanged across every attempt — strict numeric
			// equality. The adjustment formula is purely additive (no
			// floating-point accumulation possible when the branch never
			// fires), so any non-zero drift is a regression.
			for (const attempt of result.attempts) {
				expect(attempt.peakGainDb).toBe(initialPeakGainDb);
			}
		}, TEST_TIMEOUT_MS_INNER);

		it("converges within maxAttempts on a moderate-contrast fixture with peakTolerance = 0.1", async () => {
			const source = makeSyntheticSource(0xF00D_FACE, 0.1, 0.4);
			const metrics = measureSourceMetrics(source);
			const buffer = await makeBufferFromChannels(source);

			const targetLufs = Math.round((metrics.integratedLufs + 3) * 10) / 10;
			const targetTp = metrics.truePeakDb + 5;
			const result = await iterateForTargets({
				buffer,
				sampleRate: SAMPLE_RATE,
				anchorBase: { floorDb: -50, pivotDb: -10 },
				smoothingMs: 1,
				targetLufs,
				targetTp,
				limitAutoDb: Number.POSITIVE_INFINITY,
				sourceLufs: metrics.integratedLufs,
				sourcePeakDb: metrics.truePeakDb,
				maxAttempts: 10,
				tolerance: 0.5,
				peakTolerance: 0.1,
			});

			expect(result.converged).toBe(true);
			expect(result.attempts.length).toBeLessThanOrEqual(10);

			const lastAttempt = result.attempts[result.attempts.length - 1];

			expect(lastAttempt).toBeDefined();
			expect(Math.abs(lastAttempt?.lufsErr ?? Infinity)).toBeLessThan(0.5);
			expect(lastAttempt?.peakOvershoot ?? Infinity).toBeLessThanOrEqual(0.1);
		}, TEST_TIMEOUT_MS_INNER);

		it("infeasible target exhausts maxAttempts with bestPeakGainDb at or above the -60 floor", async () => {
			const source = makeSyntheticSource(0xDEAD_F00D, 0.1, 0.4);
			const metrics = measureSourceMetrics(source);
			const buffer = await makeBufferFromChannels(source);

			const targetLufs = metrics.integratedLufs + 20;
			const targetTp = metrics.truePeakDb - 10;
			const result = await iterateForTargets({
				buffer,
				sampleRate: SAMPLE_RATE,
				anchorBase: { floorDb: -50, pivotDb: -30 },
				smoothingMs: 5,
				targetLufs,
				targetTp,
				limitAutoDb: Number.POSITIVE_INFINITY,
				sourceLufs: metrics.integratedLufs,
				sourcePeakDb: metrics.truePeakDb,
				maxAttempts: 10,
				tolerance: 0.5,
				peakTolerance: 0.1,
			});

			expect(result.converged).toBe(false);
			expect(result.attempts.length).toBe(10);
			expect(result.bestPeakGainDb).toBeGreaterThanOrEqual(-60);
			for (const attempt of result.attempts) {
				expect(attempt.peakGainDb).toBeGreaterThanOrEqual(-60);
			}
			expect(result.bestSmoothedEnvelope.length).toBeGreaterThan(0);
		}, TEST_TIMEOUT_MS_INNER);
	});

	describe("Phase 4 envelope shape", () => {
		const TEST_TIMEOUT_MS_INNER = 120_000;

		it("bestSmoothedEnvelope is exactly frames * OVERSAMPLE_FACTOR samples (single attempt, multi-chunk fixture)", async () => {
			const source = makeSyntheticSource(0xCAFE_F00D, 0.1, 0.4);
			const metrics = measureSourceMetrics(source);
			const buffer = await makeBufferFromChannels(source);

			const targetLufs = Math.round((metrics.integratedLufs + 3) * 10) / 10;
			const result = await iterateForTargets({
				buffer,
				sampleRate: SAMPLE_RATE,
				anchorBase: { floorDb: -50, pivotDb: -10 },
				smoothingMs: 1,
				targetLufs,
				targetTp: undefined,
				limitAutoDb: Number.POSITIVE_INFINITY,
				sourceLufs: metrics.integratedLufs,
				sourcePeakDb: metrics.truePeakDb,
				maxAttempts: 1,
				tolerance: 0.5,
				peakTolerance: 0.1,
			});

			expect(result.attempts.length).toBe(1);
			expect(result.bestSmoothedEnvelope.length).toBe(FRAME_COUNT * OVERSAMPLE_FACTOR);

			// Sanity-check: every sample is finite and positive. Catches a
			// regression where the walk-A streaming loop fails to fill the
			// trailing portion of `forwardScratch` (e.g. a missed `isFinal`
			// flush). Use a manual scan with summary asserts (rather than
			// per-sample `expect()`) so the test runs in seconds, not minutes.
			let allFinite = true;
			let allPositive = true;
			let minValue = Infinity;
			let maxValue = -Infinity;

			for (let upIdx = 0; upIdx < result.bestSmoothedEnvelope.length; upIdx++) {
				const value = result.bestSmoothedEnvelope[upIdx]!;

				if (!Number.isFinite(value)) allFinite = false;
				if (!(value > 0)) allPositive = false;
				if (value < minValue) minValue = value;
				if (value > maxValue) maxValue = value;
			}

			expect(allFinite).toBe(true);
			expect(allPositive).toBe(true);
			// Gain bounded by the curve's clamps (B ∈ [-30, 30] dB → linear
			// gain ∈ ~[0.0316, 31.6]). A zero gain or non-finite would
			// indicate a fill-gap regression.
			expect(minValue).toBeGreaterThan(0);
			expect(maxValue).toBeLessThan(50);
		}, TEST_TIMEOUT_MS_INNER);
	});
});
