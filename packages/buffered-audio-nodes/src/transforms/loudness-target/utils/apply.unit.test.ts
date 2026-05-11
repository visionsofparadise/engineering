import { Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { describe, expect, it } from "vitest";
import { applyOversampledChunk } from "./apply";

const SAMPLE_RATE = 48_000;
const FACTOR = 4;

/**
 * Tiny LCG (numerical-recipes constants) for deterministic noise.
 * Mirrors `loudness-shaper/utils/apply-final.unit.test.ts`'s helper.
 */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

		return state / 0x80_00_00_00 - 1;
	};
}

function makeSineWithNoise(seed: number, frames: number, amplitude: number, frequency: number): Float32Array {
	const channel = new Float32Array(frames);
	const rand = makeLcg(seed);
	const angularStep = (2 * Math.PI * frequency) / SAMPLE_RATE;

	for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
		channel[frameIdx] = amplitude * (0.7 * Math.sin(angularStep * frameIdx) + 0.3 * rand());
	}

	return channel;
}

/**
 * Build a 4×-rate ramp envelope. Length is `frames * FACTOR`. Used to
 * exercise the chunk-boundary continuity tests with a non-constant
 * envelope at the upsampled rate.
 */
function makeRampGainUpsampled(frames: number, factor: number, fromGain: number, toGain: number): Float32Array {
	const upLength = frames * factor;
	const envelope = new Float32Array(upLength);

	for (let upIdx = 0; upIdx < upLength; upIdx++) {
		const t = upLength <= 1 ? 0 : upIdx / (upLength - 1);

		envelope[upIdx] = fromGain + (toGain - fromGain) * t;
	}

	return envelope;
}

/** Native-rate ramp (used by the factor-1 cross-helper test where envelope length = frames). */
function makeRampGain(frames: number, fromGain: number, toGain: number): Float32Array {
	const envelope = new Float32Array(frames);

	for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
		const t = frames <= 1 ? 0 : frameIdx / (frames - 1);

		envelope[frameIdx] = fromGain + (toGain - fromGain) * t;
	}

	return envelope;
}

describe("applyOversampledChunk", () => {
	it("multi-chunk apply matches single-chunk apply (oversampler state continuity across chunks, 4×-rate envelope)", () => {
		// Phase 4 chunked-equivalence test. The 4×-rate envelope means
		// each upsampled sample sees its own gain value (no more zero-
		// order-hold from native rate). Persistent per-channel
		// `Oversampler` state across chunks means the two outputs match
		// within float-rounding tolerance.
		const frames = 4096;
		const source = makeSineWithNoise(0x0A0B_0C0D, frames, 0.2, 1000);
		const gainEnvelopeUp = makeRampGainUpsampled(frames, FACTOR, 0.5, 1.0);

		// Single-chunk path.
		const singleOversamplers = [new Oversampler(FACTOR, SAMPLE_RATE)];
		const [single] = applyOversampledChunk({
			chunkSamples: [source],
			smoothedGain: gainEnvelopeUp,
			offset: 0,
			oversamplers: singleOversamplers,
			factor: FACTOR,
		});

		// Multi-chunk paths with the SAME oversampler instance carried
		// across all chunks. Multiple split granularities exercise the
		// state-continuity contract under different chunk sizes.
		const splitPoints: ReadonlyArray<ReadonlyArray<number>> = [
			[2048],
			[1024, 2048, 3072],
			[256, 768, 1024, 1500, 2500, 3000, 3500],
		];

		for (const splits of splitPoints) {
			const splitOversamplers = [new Oversampler(FACTOR, SAMPLE_RATE)];
			const reassembled = new Float32Array(frames);
			let cursor = 0;

			const boundaries = [...splits, frames];

			for (const boundary of boundaries) {
				const chunkSlice = new Float32Array(source.subarray(cursor, boundary));
				const [chunkOut] = applyOversampledChunk({
					chunkSamples: [chunkSlice],
					smoothedGain: gainEnvelopeUp,
					offset: cursor,
					oversamplers: splitOversamplers,
					factor: FACTOR,
				});

				expect(chunkOut?.length).toBe(boundary - cursor);

				reassembled.set(chunkOut ?? new Float32Array(0), cursor);
				cursor = boundary;
			}

			let maxError = 0;

			for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
				const diff = Math.abs((single?.[frameIdx] ?? 0) - reassembled[frameIdx]!);

				if (diff > maxError) maxError = diff;
			}

			expect(maxError).toBeLessThan(1e-5);
		}
	});

	it("constant 4×-rate gain reduces to native scalar multiply (upsample → ×c → downsample = native × c)", () => {
		// Anchor for the 4×-rate apply path: a constant 4×-rate gain
		// envelope of `c` produces the same bytes as a native-rate
		// scalar multiply by `c`. Algebraically: upsample(x) is the
		// linear AA-filtered interpolation of x's spectrum, multiplying
		// every upsampled sample by constant `c` is linear (commutes
		// with the filter), and downsample then takes the AA-filtered
		// decimation back to native rate. So oversample(x, multiply
		// by c) = c * x for any constant c — the LP filter passband is
		// unity at DC and below 0.45 × Nyquist, so the in-band signal
		// is preserved up to the same AA bias that affects ALL passes
		// of the oversampler.
		//
		// Concretely: build a 4×-rate envelope filled with `c`, run
		// `applyOversampledChunk` on it. Build a reference by calling
		// `Oversampler.oversample(source, x => x * c)` directly (the
		// canonical "upsample → multiply by constant → downsample"
		// expression). Both produce the same output bytes within float
		// tolerance.
		const frames = 1024;
		const source = makeSineWithNoise(0x1357_2468, frames, 0.25, 440);
		const constant = 0.6;

		const upConstantEnvelope = new Float32Array(frames * FACTOR);

		upConstantEnvelope.fill(constant);

		const oversamplersA = [new Oversampler(FACTOR, SAMPLE_RATE)];
		const [outputUpConstant] = applyOversampledChunk({
			chunkSamples: [source],
			smoothedGain: upConstantEnvelope,
			offset: 0,
			oversamplers: oversamplersA,
			factor: FACTOR,
		});

		// Reference: same source through a fresh oversampler with the
		// `oversample` convenience that multiplies every upsampled
		// sample by the same constant. The two expressions of the same
		// constant-c semantic must match byte-for-byte.
		const oversamplersB = [new Oversampler(FACTOR, SAMPLE_RATE)];
		const reference = oversamplersB[0]!.oversample(source, (x) => x * constant);

		expect(outputUpConstant?.length).toBe(frames);
		expect(reference.length).toBe(frames);

		let maxError = 0;

		for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
			const diff = Math.abs((outputUpConstant?.[frameIdx] ?? 0) - (reference[frameIdx] ?? 0));

			if (diff > maxError) maxError = diff;
		}

		expect(maxError).toBeLessThan(1e-6);
	});

	it("factor 1 pass-through produces native scalar multiply", () => {
		// At factor 1 the gain envelope length equals `frames`
		// (`frames * 1`). The helper's index math degenerates to
		// `gainIdx = offset + upIdx` (the same as a native-rate scalar
		// multiply). `Oversampler` returns a fresh copy of input at
		// factor 1 with no filter state changes (per `oversample.ts`);
		// the result equals an inline `samples[i] * gain[i]` multiply
		// byte-for-byte. The native-rate `applySmoothedGainChunk`
		// helper was retired in Phase 4 (the production pipeline only
		// uses `applyOversampledChunk` at factor 4); this test stays
		// against an inline native multiply as the reference.
		const frames = 1024;
		const source = makeSineWithNoise(0x1234_5678, frames, 0.3, 440);
		const gainEnvelope = makeRampGain(frames, 0.4, 1.2);

		const oversamplers = [new Oversampler(1, SAMPLE_RATE)];
		const [oversampledOut] = applyOversampledChunk({
			chunkSamples: [source],
			smoothedGain: gainEnvelope,
			offset: 0,
			oversamplers,
			factor: 1,
		});

		const referenceOut = new Float32Array(frames);

		for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
			referenceOut[frameIdx] = (source[frameIdx] ?? 0) * (gainEnvelope[frameIdx] ?? 0);
		}

		expect(oversampledOut?.length).toBe(frames);

		let maxError = 0;

		for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
			const diff = Math.abs((oversampledOut?.[frameIdx] ?? 0) - (referenceOut[frameIdx] ?? 0));

			if (diff > maxError) maxError = diff;
		}

		// Both paths multiply the same source samples by the same gain
		// values; difference is zero modulo IEEE-754 multiply order.
		expect(maxError).toBeLessThan(1e-9);
	});

	it("output length equals input length per channel at factor 4", () => {
		const frames = 2048;
		const source = makeSineWithNoise(0xDEAD_BEEF, frames, 0.25, 880);
		const gainEnvelopeUp = makeRampGainUpsampled(frames, FACTOR, 0.6, 0.9);

		const oversamplers = [new Oversampler(FACTOR, SAMPLE_RATE)];
		const [output] = applyOversampledChunk({
			chunkSamples: [source],
			smoothedGain: gainEnvelopeUp,
			offset: 0,
			oversamplers,
			factor: FACTOR,
		});

		expect(output?.length).toBe(frames);
	});
});
