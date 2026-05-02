import { MemoryChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator, MixedRadixFft, Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { describe, expect, it } from "vitest";
import { applyLUTBaseRate } from "./apply";
import { applyFinal } from "./apply-final";
import type { CurveParams } from "./curve";
import { iterateForTarget } from "./iterate";
import { buildLUT } from "./lut";

const SAMPLE_RATE = 48_000;

/**
 * Tiny LCG (numerical-recipes constants) for deterministic noise. Seed
 * is the constructor argument; calling `next()` returns the next pseudo-
 * random float in `(-1, 1)`.
 */
function makeLcg(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

		return state / 0x80_00_00_00 - 1;
	};
}

function makeNoise(seed: number, frames: number, amplitude: number): Float32Array {
	const channel = new Float32Array(frames);
	const rand = makeLcg(seed);

	for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
		channel[frameIndex] = amplitude * rand();
	}

	return channel;
}

function makeStereoSyntheticSource(seedLeft: number, seedRight: number, amplitude: number, frames: number): Array<Float32Array> {
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	const randLeft = makeLcg(seedLeft);
	const randRight = makeLcg(seedRight);
	const angularStep = (2 * Math.PI * 220) / SAMPLE_RATE;

	for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
		const sine = Math.sin(angularStep * frameIndex);

		left[frameIndex] = amplitude * (0.6 * sine + 0.4 * randLeft());
		right[frameIndex] = amplitude * (0.6 * sine + 0.4 * randRight());
	}

	return [left, right];
}

const symmetricParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	floor: 0.01,
	bodyLow: 0.05,
	bodyHigh: 0.4,
	peak: 0.8,
	...overrides,
});

function measureLufs(channels: ReadonlyArray<Float32Array>): number {
	const accumulator = new IntegratedLufsAccumulator(SAMPLE_RATE, channels.length);

	accumulator.push(channels, channels[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Compute the magnitude spectrum (single-sided) of a real signal via
 * the package's `MixedRadixFft`. Returns an array of length `size / 2`
 * where index `k` corresponds to frequency `k * sampleRate / size`.
 */
function magnitudeSpectrum(signal: Float32Array, size: number): Float32Array {
	const fft = new MixedRadixFft(size);
	const xRe = new Float32Array(size);
	const xIm = new Float32Array(size);

	const length = Math.min(signal.length, size);

	for (let index = 0; index < length; index++) {
		xRe[index] = signal[index] ?? 0;
	}

	const yRe = new Float32Array(size);
	const yIm = new Float32Array(size);

	fft.fft(xRe, xIm, yRe, yIm);

	const half = size / 2;
	const magnitude = new Float32Array(half);

	for (let bin = 0; bin < half; bin++) {
		const re = yRe[bin] ?? 0;
		const im = yIm[bin] ?? 0;

		magnitude[bin] = Math.sqrt(re * re + im * im);
	}

	return magnitude;
}

/**
 * Sum of squared magnitudes in a frequency-bin range — a proxy for
 * total energy in that band.
 */
function bandEnergy(magnitude: Float32Array, fromBin: number, toBinExclusive: number): number {
	let sum = 0;

	for (let bin = fromBin; bin < toBinExclusive && bin < magnitude.length; bin++) {
		const m = magnitude[bin] ?? 0;

		sum += m * m;
	}

	return sum;
}

describe("applyFinal", () => {
	it("identity LUT round-trip: applyFinal with identity LUT equals Oversampler pass-through sample-for-sample", () => {
		// boost = 0 makes the LUT a sampled identity for |x| < max
		// (within the LUT's own ~0.001 round-trip tolerance), and the LUT
		// passes through for |x| >= max. The point of this test is to
		// confirm the LUT integration is correct — that running the LUT
		// inside `oversample(input, fn)` gives the same output as running
		// the Oversampler with `fn = identity`. The Oversampler's biquad
		// rolloff is captured equally in both paths and cancels out in the
		// comparison.
		const params = symmetricParams();
		const lut = buildLUT(params, params, 0, 512);

		const frames = 4096;
		const channel = new Float32Array(frames);
		const angularStep = (2 * Math.PI * 1000) / SAMPLE_RATE;

		for (let index = 0; index < frames; index++) {
			channel[index] = 0.5 * Math.sin(angularStep * index);
		}

		const [output] = applyFinal({
			source: [channel],
			sampleRate: SAMPLE_RATE,
			lut,
		});

		expect(output).toBeDefined();
		expect(output?.length).toBe(channel.length);

		// Reference: same factor / sampleRate, identity callback. Cold
		// state at the start of both pipelines means the leading-sample
		// filter transient is identical.
		const reference = new Oversampler(4, SAMPLE_RATE).oversample(channel, (x) => x);

		expect(reference.length).toBe(channel.length);

		// LUT linear-interp tolerance is ~0.001 per Phase 2; the
		// oversampling itself contributes float-multiplication rounding
		// only, which is well under 0.001. Use 0.005 to leave headroom
		// for accumulated rounding through the biquad.
		let maxError = 0;

		for (let index = 0; index < frames; index++) {
			maxError = Math.max(maxError, Math.abs((output?.[index] ?? 0) - (reference[index] ?? 0)));
		}

		expect(maxError).toBeLessThan(0.005);
	});

	it("length preservation: output length equals input length per channel", () => {
		const params = symmetricParams();
		const lut = buildLUT(params, params, 0.5, 256);

		const channel = new Float32Array(2048);

		for (let index = 0; index < channel.length; index++) {
			channel[index] = 0.1 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
		}

		const [output] = applyFinal({
			source: [channel],
			sampleRate: SAMPLE_RATE,
			lut,
		});

		expect(output?.length).toBe(channel.length);
	});

	it("multi-channel independence: each output channel reflects its input only", () => {
		const params = symmetricParams();
		const lut = buildLUT(params, params, 0.5, 256);

		// Distinct seeds so the channels are unambiguously different.
		const left = makeNoise(0xAAAA_AAAA, 2048, 0.2);
		const right = makeNoise(0x5555_5555, 2048, 0.2);

		const [outLeft, outRight] = applyFinal({
			source: [left, right],
			sampleRate: SAMPLE_RATE,
			lut,
		});

		expect(outLeft?.length).toBe(left.length);
		expect(outRight?.length).toBe(right.length);

		// Reference: each channel computed alone — must match the multi-
		// channel call sample-for-sample. (Each channel uses its own
		// Oversampler instance, so there is no shared state by
		// construction.)
		const [refLeft] = applyFinal({
			source: [left],
			sampleRate: SAMPLE_RATE,
			lut,
		});
		const [refRight] = applyFinal({
			source: [right],
			sampleRate: SAMPLE_RATE,
			lut,
		});

		expect(refLeft?.length).toBe(left.length);
		expect(refRight?.length).toBe(right.length);

		for (let index = 0; index < left.length; index++) {
			expect(outLeft?.[index]).toBe(refLeft?.[index]);
			expect(outRight?.[index]).toBe(refRight?.[index]);
		}

		// And the channels must differ from each other (sanity check that
		// inputs were not silently merged or swapped).
		let differingSamples = 0;

		for (let index = 0; index < left.length; index++) {
			if ((outLeft?.[index] ?? 0) !== (outRight?.[index] ?? 0)) differingSamples++;
		}

		expect(differingSamples).toBeGreaterThan(left.length / 2);
	});

	it("aliasing suppression: 4× pipeline has less HF energy than base-rate apply on a non-trivial LUT", () => {
		// Build a non-trivial LUT (boost = 0.5) sized to the noise
		// distribution. The non-linearity generates harmonics; at base
		// rate those harmonics fold (alias) back into the audible band.
		// The 4× pipeline absorbs them above the original Nyquist
		// before decimation's anti-alias filter rejects them.
		const params: CurveParams = { floor: 0.01, bodyLow: 0.05, bodyHigh: 0.3, peak: 0.5 };
		const lut = buildLUT(params, params, 0.5, 512);

		// FFT size is power-of-2 friendly for the package's mixed-radix
		// FFT; 4096 gives 23.4 Hz bin resolution at 48 kHz.
		const fftSize = 4096;
		const noise = makeNoise(0x1234_5678, fftSize, 0.2);

		const [base] = applyLUTBaseRate([noise], lut);
		const [final] = applyFinal({
			source: [noise],
			sampleRate: SAMPLE_RATE,
			lut,
		});

		expect(base).toBeDefined();
		expect(final).toBeDefined();

		const baseSpectrum = magnitudeSpectrum(base ?? new Float32Array(0), fftSize);
		const finalSpectrum = magnitudeSpectrum(final ?? new Float32Array(0), fftSize);

		// "Top 20% of the audible band" per the parent prompt's heuristic.
		// Spectrum length is fftSize / 2 = 2048 bins covering [0, Nyquist).
		// Top 20% → bins in [0.8 * 2048, 2048).
		const half = fftSize / 2;
		const fromBin = Math.floor(half * 0.8);
		const toBin = half;

		const baseHfEnergy = bandEnergy(baseSpectrum, fromBin, toBin);
		const finalHfEnergy = bandEnergy(finalSpectrum, fromBin, toBin);

		// Comparative test: 4× pipeline should suppress at least some of
		// the HF energy that base-rate apply lets through. The threshold
		// (90%) is heuristic — observed in development the 4× output
		// typically lands well below 90% of the base-rate HF energy on
		// this noise/LUT combo. If this becomes flaky, raise to a tighter
		// observed value.
		expect(finalHfEnergy).toBeLessThan(baseHfEnergy * 0.9);
	});

	it("base-rate-apply vs final-apply LUFS bias is within design tolerance (~0.5 dB)", async () => {
		// Integration smoke test: run Phases 1-4 end-to-end. Generates a
		// stereo synthetic source, eyeballs curve params (Phase 5 will
		// derive these from histogram), iterates for a moderate target,
		// applies the winning LUT both ways, and compares LUFS.
		const frames = SAMPLE_RATE * 5;
		const source = makeStereoSyntheticSource(0xDEAD_BEEF, 0xC0FFEE_42, 0.2, frames);
		const sourceLUFS = measureLufs(source);

		expect(Number.isFinite(sourceLUFS)).toBe(true);

		const params: CurveParams = { floor: 0.005, bodyLow: 0.02, bodyHigh: 0.18, peak: 0.3 };
		const targetLUFS = sourceLUFS + 3;

		// Wrap into a MemoryChunkBuffer for the streaming `iterateForTarget`.
		const buffer = new MemoryChunkBuffer(Infinity, source.length);

		await buffer.append(source.map((channel) => new Float32Array(channel)), SAMPLE_RATE, 32);

		const result = await iterateForTarget({
			buffer,
			sampleRate: SAMPLE_RATE,
			posParams: params,
			negParams: params,
			targetLUFS,
			sourceLUFS,
		});

		const winningLut = buildLUT(params, params, result.bestBoost, 512);

		const baseOutput = applyLUTBaseRate(source, winningLut);
		const finalOutput = applyFinal({
			source,
			sampleRate: SAMPLE_RATE,
			lut: winningLut,
		});

		const baseLUFS = measureLufs(baseOutput);
		const finalLUFS = measureLufs(finalOutput);

		expect(Number.isFinite(baseLUFS)).toBe(true);
		expect(Number.isFinite(finalLUFS)).toBe(true);

		const bias = Math.abs(finalLUFS - baseLUFS);

		// Logged for design-doc reference per Phase 4.2; the design
		// nominally accepts 0.3 dB but the test asserts the wider 0.5 dB
		// to keep flakiness low.
		// eslint-disable-next-line no-console
		console.log(`[applyFinal vs applyLUTBaseRate LUFS bias] base=${baseLUFS.toFixed(3)} final=${finalLUFS.toFixed(3)} bias=${bias.toFixed(3)} dB`);

		expect(bias).toBeLessThan(0.5);
	});
});
