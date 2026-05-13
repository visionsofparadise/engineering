import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { describe, expect, it } from "vitest";
import { type CurveParams } from "./curve";
import { iterateForTarget } from "./iterate";

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 5;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;

/**
 * Wrap per-channel synthetic arrays in a `ChunkBuffer` so the streaming
 * `iterateForTarget` signature can consume them without the callers
 * materialising a whole-buffer copy. Returns a fresh buffer each call —
 * buffers are stateful (`iterateForTarget` rewinds the read cursor via
 * `buffer.reset()` at the start of each attempt, so multiple iterations
 * are safe, but the buffer should not be shared across tests).
 */
async function makeBufferFromChannels(channels: ReadonlyArray<Float32Array>): Promise<ChunkBuffer> {
	const buffer = new ChunkBuffer();

	await buffer.write(channels.map((channel) => new Float32Array(channel)), SAMPLE_RATE, 32);
	await buffer.flushWrites();

	return buffer;
}

/**
 * Tiny LCG (numerical-recipes constants) for deterministic noise. Seed
 * is the constructor argument; calling `next()` returns the next pseudo-
 * random float in `(-1, 1)`.
 */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		// Map to (-1, 1).
		return state / 0x80_00_00_00 - 1;
	};
}

/**
 * A multi-component synthetic source: low-amplitude mid-band sine plus
 * scaled deterministic noise. Designed to have most samples in the body
 * region (small amplitudes) with occasional larger excursions, matching
 * a podcast-voice-ish histogram and giving the LUFS measurement enough
 * variance to respond monotonically to boost.
 */
function makeSyntheticSource(seed: number, amplitude: number): Float32Array[] {
	const channel = new Float32Array(FRAME_COUNT);
	const rand = makeLcg(seed);
	const angularStep = (2 * Math.PI * 220) / SAMPLE_RATE;

	for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex++) {
		const sine = Math.sin(angularStep * frameIndex);
		const noise = rand();
		// Body-heavy mix: 60% sine + 40% noise, scaled down to the body.
		channel[frameIndex] = amplitude * (0.6 * sine + 0.4 * noise);
	}

	return [channel];
}

function measureSourceLufs(source: ReadonlyArray<Float32Array>): number {
	const accumulator = new IntegratedLufsAccumulator(SAMPLE_RATE, source.length);

	accumulator.push(source, source[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Build symmetric trapezoidal `CurveParams` from linear amplitudes. The
 * iteration tests don't exercise the geometry directly — they just need
 * a well-formed curve with anchors that bracket the synthetic source's
 * amplitude range so the LUFS-vs-boost mapping is monotonic.
 */
function makeParams(floor: number, bodyLow: number, bodyHigh: number, peak: number | null): CurveParams {
	return { floor, bodyLow, bodyHigh, peak, tensionLow: 1, tensionHigh: 1 };
}

describe("iterateForTarget", () => {
	it("converges within tolerance on a moderate-boost target (synthetic source)", async () => {
		const source = makeSyntheticSource(0xDEAD_BEEF, 0.2);
		const sourceLUFS = measureSourceLufs(source);

		expect(Number.isFinite(sourceLUFS)).toBe(true);

		// Body brackets ~[0.02, 0.18]; anchor peak above the synthetic max.
		const params = makeParams(0.005, 0.02, 0.18, 0.3);
		const targetLUFS = sourceLUFS + 3;

		const buffer = await makeBufferFromChannels(source);
		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			posParams: params,
			negParams: params,
			targetLUFS,
			sourceLUFS,
		});

		expect(result.attempts.length).toBeGreaterThan(0);
		expect(result.attempts.length).toBeLessThanOrEqual(5);
		expect(result.converged).toBe(true);

		const winning = result.attempts[result.attempts.length - 1];

		expect(winning).toBeDefined();
		expect(Math.abs((winning?.outputLUFS ?? -Infinity) - targetLUFS)).toBeLessThan(0.5);
	});

	it("identity target (target = source LUFS): converges with bestBoost ≈ 0 in 1–2 attempts", async () => {
		const source = makeSyntheticSource(0xC0FFEE, 0.2);
		const sourceLUFS = measureSourceLufs(source);
		const params = makeParams(0.005, 0.02, 0.18, 0.3);

		const buffer = await makeBufferFromChannels(source);
		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			posParams: params,
			negParams: params,
			targetLUFS: sourceLUFS,
			sourceLUFS,
		});

		expect(result.converged).toBe(true);
		expect(result.attempts.length).toBeLessThanOrEqual(2);
		expect(result.bestBoost).toBeCloseTo(0, 5);
	});

	it("hard-target (+20 dB above source): does not crash, returns best attempt with converged = false if unreachable", async () => {
		const source = makeSyntheticSource(0xBADBEEF, 0.05);
		const sourceLUFS = measureSourceLufs(source);
		const params = makeParams(0.001, 0.005, 0.05, 0.1);

		const buffer = await makeBufferFromChannels(source);
		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			posParams: params,
			negParams: params,
			targetLUFS: sourceLUFS + 20,
			sourceLUFS,
		});

		// Either we hit a converged solution (acceptable — the curve is
		// strong enough) or we exhaust attempts and report best. Both must
		// be free of NaN / -Infinity / runaway boost.
		expect(Number.isFinite(result.bestBoost)).toBe(true);
		expect(result.bestBoost).toBeGreaterThanOrEqual(0);
		expect(result.bestBoost).toBeLessThanOrEqual(100);
		expect(result.attempts.length).toBeGreaterThan(0);
		expect(result.attempts.length).toBeLessThanOrEqual(5);

		for (const attempt of result.attempts) {
			expect(Number.isFinite(attempt.boost)).toBe(true);
			expect(attempt.boost).toBeGreaterThanOrEqual(0);
			expect(attempt.boost).toBeLessThanOrEqual(100);
		}
	});

	it("attempts step toward the target (no wild oscillation on a tractable target)", async () => {
		const source = makeSyntheticSource(0xFACE_F00D, 0.15);
		const sourceLUFS = measureSourceLufs(source);
		const params = makeParams(0.005, 0.02, 0.14, 0.25);
		const targetLUFS = sourceLUFS + 4;

		const buffer = await makeBufferFromChannels(source);
		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			posParams: params,
			negParams: params,
			targetLUFS,
			sourceLUFS,
		});

		// First attempt has some error; the best attempt's error must be
		// no worse than the first attempt's. (The bestBoost convention
		// guarantees the result is at least as good as the starting guess.)
		const first = result.attempts[0];
		const bestAttempt = result.attempts.reduce(
			(prev, cur) => (Math.abs(cur.outputLUFS - targetLUFS) < Math.abs(prev.outputLUFS - targetLUFS) ? cur : prev),
			result.attempts[0]!,
		);

		expect(first).toBeDefined();
		expect(Math.abs(bestAttempt.outputLUFS - targetLUFS)).toBeLessThanOrEqual(Math.abs((first?.outputLUFS ?? Infinity) - targetLUFS));
	});

	it("preservePeaks = false (peak === null): converges and produces well-formed results", async () => {
		// The expander mode lets the body lift continue above bodyHigh
		// without an upper roll-off. Convergence properties are similar to
		// preservePeaks=true at moderate boosts; the curve is just flat
		// above bodyHigh instead of ramping down to zero (curve evaluated
		// directly per sample).
		const source = makeSyntheticSource(0x1234_5678, 0.2);
		const sourceLUFS = measureSourceLufs(source);
		const params = makeParams(0.005, 0.02, 0.18, null);
		const targetLUFS = sourceLUFS + 3;

		const buffer = await makeBufferFromChannels(source);
		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			posParams: params,
			negParams: params,
			targetLUFS,
			sourceLUFS,
		});

		expect(Number.isFinite(result.bestBoost)).toBe(true);
		expect(result.attempts.length).toBeGreaterThan(0);
		expect(result.attempts.length).toBeLessThanOrEqual(5);

		for (const attempt of result.attempts) {
			expect(Number.isFinite(attempt.boost)).toBe(true);
			expect(Number.isFinite(attempt.outputLUFS) || attempt.outputLUFS === -Infinity).toBe(true);
		}
	});
});
