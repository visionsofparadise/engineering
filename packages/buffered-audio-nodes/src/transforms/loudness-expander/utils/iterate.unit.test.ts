import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { afterEach, describe, expect, it } from "vitest";
import { computeLinkedDetection } from "./detect";
import { iterateForTarget } from "./iterate";
import { type CurveParams } from "./curve";

const SAMPLE_RATE = 48_000;
const DURATION_SECONDS = 4;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;

const buffersToClose: ChunkBuffer[] = [];

/**
 * Wrap per-channel synthetic arrays in a `ChunkBuffer` so the streaming
 * `iterateForTarget` signature can consume them. Returns a fresh buffer
 * each call.
 */
async function makeBufferFromChannels(channels: ReadonlyArray<Float32Array>): Promise<ChunkBuffer> {
	const buffer = new ChunkBuffer();

	await buffer.write(channels.map((channel) => new Float32Array(channel)), SAMPLE_RATE, 32);
	await buffer.flushWrites();

	buffersToClose.push(buffer);

	return buffer;
}

/**
 * Tiny LCG (numerical-recipes constants) for deterministic noise.
 */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

		return state / 0x80_00_00_00 - 1;
	};
}

/**
 * Body-heavy synthetic source: low-amplitude mid-band sine plus scaled
 * deterministic noise. Mirrors the shaper's `iterate.unit.test.ts`
 * helper so the LUFS-vs-boost mapping is monotonic over the range we
 * exercise.
 */
function makeSyntheticSource(seed: number, amplitude: number): Array<Float32Array> {
	const channel = new Float32Array(FRAME_COUNT);
	const rand = makeLcg(seed);
	const angularStep = (2 * Math.PI * 220) / SAMPLE_RATE;

	for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex++) {
		const sine = Math.sin(angularStep * frameIndex);
		const noise = rand();

		channel[frameIndex] = amplitude * (0.6 * sine + 0.4 * noise);
	}

	return [channel];
}

function measureSourceLufsInline(source: ReadonlyArray<Float32Array>): number {
	const accumulator = new IntegratedLufsAccumulator(SAMPLE_RATE, source.length);

	accumulator.push(source, source[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Single-pivot curve params bracketing the synthetic source's
 * amplitude profile. The synthetic source has peak amplitude ≈
 * `amplitude`; pivot is set just below that so the body sits within
 * the rising ramp and the iteration's LUFS-vs-boost mapping is
 * monotonic.
 */
function makeCurveParams(floor: number, pivot: number): CurveParams {
	return { floor, pivot, tension: 1 };
}

describe("iterateForTarget", () => {
	afterEach(async () => {
		for (const buf of buffersToClose) await buf.close();
		buffersToClose.length = 0;
	});

	it("converges within tolerance on a typical source", async () => {
		const source = makeSyntheticSource(0xDEAD_BEEF, 0.2);
		const sourceLUFS = measureSourceLufsInline(source);

		expect(Number.isFinite(sourceLUFS)).toBe(true);

		const buffer = await makeBufferFromChannels(source);
		const detection = await computeLinkedDetection(buffer);

		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			detection,
			curveParams: makeCurveParams(0.005, 0.18),
			smoothingMs: 1,
			targetLUFS: sourceLUFS + 3,
			sourceLUFS,
		});

		expect(result.converged).toBe(true);
		expect(result.bestSmoothedEnvelope.length).toBe(FRAME_COUNT);
		expect(result.attempts.length).toBeGreaterThan(0);
		expect(result.attempts.length).toBeLessThanOrEqual(10);
	});

	it("bestSmoothedEnvelope is bounded near (1 + bestBoost)", async () => {
		const source = makeSyntheticSource(0xFACE_F00D, 0.2);
		const sourceLUFS = measureSourceLufsInline(source);

		const buffer = await makeBufferFromChannels(source);
		const detection = await computeLinkedDetection(buffer);

		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			detection,
			curveParams: makeCurveParams(0.005, 0.18),
			smoothingMs: 1,
			targetLUFS: sourceLUFS + 3,
			sourceLUFS,
		});

		// `g_raw` is bounded above by `1 + bestBoost` (shape ∈ [0, 1]).
		// Bidirectional one-pole IIR smoothing cannot overshoot the input
		// peak by any meaningful amount on a real signal — tolerate a
		// tiny ε for floating-point ringing at the endpoints.
		const epsilon = 1e-3;
		let envelopeMax = -Infinity;

		for (let frameIndex = 0; frameIndex < result.bestSmoothedEnvelope.length; frameIndex++) {
			const value = result.bestSmoothedEnvelope[frameIndex] ?? 0;

			if (value > envelopeMax) envelopeMax = value;
		}

		expect(envelopeMax).toBeLessThanOrEqual(1 + result.bestBoost + epsilon);
	});

	it("closest-attempt fallback when tolerance unreachable", async () => {
		const source = makeSyntheticSource(0xC0FFEE, 0.2);
		const sourceLUFS = measureSourceLufsInline(source);

		const buffer = await makeBufferFromChannels(source);
		const detection = await computeLinkedDetection(buffer);

		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			detection,
			curveParams: makeCurveParams(0.005, 0.18),
			smoothingMs: 1,
			targetLUFS: sourceLUFS + 3,
			sourceLUFS,
			toleranceLUFSdB: 1e-9,
			maxAttempts: 2,
		});

		expect(result.converged).toBe(false);
		expect(result.attempts.length).toBe(2);

		const attemptBoosts = result.attempts.map((attempt) => attempt.boost);

		expect(attemptBoosts).toContain(result.bestBoost);
		expect(result.bestSmoothedEnvelope.length).toBe(FRAME_COUNT);
	});
});
