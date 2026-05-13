import { ChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { IntegratedLufsAccumulator, MixedRadixFft, Oversampler } from "@e9g/buffered-audio-nodes-utils";
import { describe, expect, it } from "vitest";
import { applyCurveBaseRateChunk } from "./apply";
import { applyFinalChunk, DEFAULT_FACTOR } from "./apply-final";
import type { CurveParams } from "./curve";
import { iterateForTarget } from "./iterate";

const SAMPLE_RATE = 48_000;

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
	tensionLow: 1,
	tensionHigh: 1,
	...overrides,
});

function measureLufs(channels: ReadonlyArray<Float32Array>): number {
	const accumulator = new IntegratedLufsAccumulator(SAMPLE_RATE, channels.length);

	accumulator.push(channels, channels[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Compute the magnitude spectrum (single-sided) of a real signal via
 * the package's `MixedRadixFft`. Returns an array of length `size / 2`.
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

function bandEnergy(magnitude: Float32Array, fromBin: number, toBinExclusive: number): number {
	let sum = 0;

	for (let bin = fromBin; bin < toBinExclusive && bin < magnitude.length; bin++) {
		const m = magnitude[bin] ?? 0;

		sum += m * m;
	}

	return sum;
}

/**
 * Wrap per-channel synthetic arrays in a `ChunkBuffer` for the
 * iteration tests below.
 */
async function makeBufferFromChannels(channels: ReadonlyArray<Float32Array>): Promise<ChunkBuffer> {
	const buffer = new ChunkBuffer();

	await buffer.write(channels.map((channel) => new Float32Array(channel)), SAMPLE_RATE, 32);
	await buffer.flushWrites();

	return buffer;
}

/**
 * Drive `applyFinalChunk` over a whole-source single chunk in test
 * space. Allocates one `Oversampler` per channel and applies the curve
 * to the entire source at one go — exercises the same code path as
 * `_unbuffer` does on each chunk, just at one giant chunk.
 *
 * Returns one Float32Array per channel sized to the input length.
 */
function runWholeFinalApply(args: {
	source: ReadonlyArray<Float32Array>;
	boost: number;
	posParams: CurveParams;
	negParams: CurveParams;
}): Array<Float32Array> {
	const oversamplers = args.source.map(() => new Oversampler(DEFAULT_FACTOR, SAMPLE_RATE));

	return applyFinalChunk({
		chunkSamples: args.source,
		boost: args.boost,
		posParams: args.posParams,
		negParams: args.negParams,
		oversamplers,
	});
}

describe("applyFinalChunk", () => {
	it("identity (boost = 0): output matches Oversampler pass-through within filter tolerance", () => {
		// boost = 0 makes the curve evaluate to gain = 1 at every sample,
		// so the only difference between this pipeline and a pass-through
		// Oversampler is float-multiplication rounding.
		const params = symmetricParams();
		const frames = 4096;
		const channel = new Float32Array(frames);
		const angularStep = (2 * Math.PI * 1000) / SAMPLE_RATE;

		for (let index = 0; index < frames; index++) {
			channel[index] = 0.5 * Math.sin(angularStep * index);
		}

		const [output] = runWholeFinalApply({
			source: [channel],
			boost: 0,
			posParams: params,
			negParams: params,
		});

		expect(output).toBeDefined();
		expect(output?.length).toBe(channel.length);

		// Reference: same factor / sampleRate, identity callback. Cold
		// state at the start of both pipelines means the leading-sample
		// filter transient is identical.
		const reference = new Oversampler(DEFAULT_FACTOR, SAMPLE_RATE).oversample(channel, (x) => x);

		expect(reference.length).toBe(channel.length);

		// Direct curve evaluation is exact (no LUT, no envelope), so the
		// only error path is float rounding through the biquad.
		let maxError = 0;

		for (let index = 0; index < frames; index++) {
			maxError = Math.max(maxError, Math.abs((output?.[index] ?? 0) - (reference[index] ?? 0)));
		}

		expect(maxError).toBeLessThan(0.005);
	});

	it("length preservation: output length equals input length per channel", () => {
		const params = symmetricParams();
		const channel = new Float32Array(2048);

		for (let index = 0; index < channel.length; index++) {
			channel[index] = 0.1 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
		}

		const [output] = runWholeFinalApply({
			source: [channel],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		expect(output?.length).toBe(channel.length);
	});

	it("multi-channel independence: running multi-channel equals running each channel solo, sample-for-sample", () => {
		// Per design-loudness-shaper §"Pipeline shape": per-channel
		// processing, no linked detection. Independent per-channel
		// `Oversampler` instances mean each channel's output depends only
		// on its own input.
		const params = symmetricParams();
		const left = makeNoise(0xAAAA_AAAA, 2048, 0.2);
		const right = makeNoise(0x5555_5555, 2048, 0.2);

		const [outLeftMulti, outRightMulti] = runWholeFinalApply({
			source: [left, right],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		const [outLeftSolo] = runWholeFinalApply({
			source: [left],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		const [outRightSolo] = runWholeFinalApply({
			source: [right],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		expect(outLeftMulti?.length).toBe(left.length);
		expect(outRightMulti?.length).toBe(right.length);

		for (let index = 0; index < left.length; index++) {
			expect(outLeftMulti?.[index]).toBeCloseTo(outLeftSolo?.[index] ?? 0, 6);
			expect(outRightMulti?.[index]).toBeCloseTo(outRightSolo?.[index] ?? 0, 6);
		}
	});

	it("aliasing suppression: 4× pipeline has less HF energy than base-rate apply on a non-trivial curve", () => {
		// Build a non-trivial curve (boost = 0.5). The non-linearity
		// generates harmonics; at base rate those harmonics fold (alias)
		// back into the audible band. The 4× pipeline absorbs them above
		// the original Nyquist before decimation's anti-alias filter
		// rejects them.
		const params: CurveParams = { floor: 0.01, bodyLow: 0.05, bodyHigh: 0.3, peak: 0.5, tensionLow: 1, tensionHigh: 1 };

		// FFT size is power-of-2 friendly for the package's mixed-radix
		// FFT; 4096 gives 23.4 Hz bin resolution at 48 kHz.
		const fftSize = 4096;
		const noise = makeNoise(0x1234_5678, fftSize, 0.2);

		// Base-rate reference: per-sample direct curve evaluation, no
		// oversampling.
		const [base] = applyCurveBaseRateChunk({
			chunkSamples: [noise],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		const [final] = runWholeFinalApply({
			source: [noise],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		expect(base).toBeDefined();
		expect(final).toBeDefined();

		const baseSpectrum = magnitudeSpectrum(base ?? new Float32Array(0), fftSize);
		const finalSpectrum = magnitudeSpectrum(final ?? new Float32Array(0), fftSize);

		const half = fftSize / 2;
		const fromBin = Math.floor(half * 0.8);
		const toBin = half;

		const baseHfEnergy = bandEnergy(baseSpectrum, fromBin, toBin);
		const finalHfEnergy = bandEnergy(finalSpectrum, fromBin, toBin);

		expect(finalHfEnergy).toBeLessThan(baseHfEnergy * 0.9);
	});

	it("base-rate-apply vs final-apply LUFS bias is within design tolerance (~0.5 dB)", { timeout: 30_000 }, async () => {
		const frames = SAMPLE_RATE * 5;
		const source = makeStereoSyntheticSource(0xDEAD_BEEF, 0xC0FFEE_42, 0.2, frames);
		const sourceLUFS = measureLufs(source);

		expect(Number.isFinite(sourceLUFS)).toBe(true);

		const params: CurveParams = { floor: 0.005, bodyLow: 0.02, bodyHigh: 0.18, peak: 0.3, tensionLow: 1, tensionHigh: 1 };
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

		// Apply the iteration's winning boost through both the base-rate
		// chunk path and the oversampling final path.
		const baseOutput = applyCurveBaseRateChunk({
			chunkSamples: source,
			boost: result.bestBoost,
			posParams: params,
			negParams: params,
		});
		const finalOutput = runWholeFinalApply({
			source,
			boost: result.bestBoost,
			posParams: params,
			negParams: params,
		});

		const baseLUFS = measureLufs(baseOutput);
		const finalLUFS = measureLufs(finalOutput);

		expect(Number.isFinite(baseLUFS)).toBe(true);
		expect(Number.isFinite(finalLUFS)).toBe(true);

		const bias = Math.abs(finalLUFS - baseLUFS);

		// eslint-disable-next-line no-console
		console.log(`[applyFinalChunk vs applyCurveBaseRateChunk LUFS bias] base=${baseLUFS.toFixed(3)} final=${finalLUFS.toFixed(3)} bias=${bias.toFixed(3)} dB`);

		expect(bias).toBeLessThan(0.5);
	});

	it("multi-chunk apply matches single-chunk apply (oversampler state continuity across chunks)", () => {
		// Drive the same source through applyFinalChunk twice: once with
		// the entire signal as a single chunk, once split into two
		// chunks. With persistent per-channel Oversampler state across
		// chunks, the two outputs must match bit-for-bit beyond float
		// rounding.
		const params: CurveParams = { floor: 0.01, bodyLow: 0.05, bodyHigh: 0.3, peak: 0.5, tensionLow: 1, tensionHigh: 1 };
		const frames = 4096;
		const noise = makeNoise(0x0A0B_0C0D, frames, 0.2);
		const boost = 0.5;

		// Single chunk path.
		const singleOversamplers = [new Oversampler(DEFAULT_FACTOR, SAMPLE_RATE)];
		const [single] = applyFinalChunk({
			chunkSamples: [noise],
			boost,
			posParams: params,
			negParams: params,
			oversamplers: singleOversamplers,
		});

		// Two-chunk path with the SAME oversampler instance carried
		// across both calls.
		const splitOversamplers = [new Oversampler(DEFAULT_FACTOR, SAMPLE_RATE)];
		const splitPoint = 1024;
		const firstChunk = new Float32Array(noise.subarray(0, splitPoint));
		const secondChunk = new Float32Array(noise.subarray(splitPoint));

		const [first] = applyFinalChunk({
			chunkSamples: [firstChunk],
			boost,
			posParams: params,
			negParams: params,
			oversamplers: splitOversamplers,
		});
		const [second] = applyFinalChunk({
			chunkSamples: [secondChunk],
			boost,
			posParams: params,
			negParams: params,
			oversamplers: splitOversamplers,
		});

		expect(single?.length).toBe(frames);
		expect((first?.length ?? 0) + (second?.length ?? 0)).toBe(frames);

		// Concatenate the split outputs.
		const reassembled = new Float32Array(frames);

		reassembled.set(first ?? new Float32Array(0), 0);
		reassembled.set(second ?? new Float32Array(0), splitPoint);

		let maxError = 0;

		for (let index = 0; index < frames; index++) {
			const diff = Math.abs((single?.[index] ?? 0) - reassembled[index]!);

			if (diff > maxError) maxError = diff;
		}

		expect(maxError).toBeLessThan(1e-6);
	});

	it("warmth > 0 (sides differ in peak): per-side params flow into the curve evaluation", () => {
		const posParams: CurveParams = { floor: 0.01, bodyLow: 0.05, bodyHigh: 0.3, peak: 0.5, tensionLow: 1, tensionHigh: 1 };
		const negParams: CurveParams = { floor: 0.01, bodyLow: 0.05, bodyHigh: 0.3, peak: 0.7, tensionLow: 1, tensionHigh: 1 };
		const frames = 1024;
		const channel = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			// Source with both pos and neg samples at amplitudes that exercise
			// the upper ramp under both peak settings.
			channel[index] = 0.4 * Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
		}

		const [withSymmetric] = runWholeFinalApply({
			source: [channel],
			boost: 0.5,
			posParams,
			negParams: posParams,
		});

		const [withAsymmetric] = runWholeFinalApply({
			source: [channel],
			boost: 0.5,
			posParams,
			negParams,
		});

		expect(withSymmetric?.length).toBe(frames);
		expect(withAsymmetric?.length).toBe(frames);

		// Different negative-side params → different output samples on at
		// least the negative half of the signal.
		let differing = 0;

		for (let index = 0; index < frames; index++) {
			if (Math.abs((withSymmetric?.[index] ?? 0) - (withAsymmetric?.[index] ?? 0)) > 1e-6) differing++;
		}

		expect(differing).toBeGreaterThan(0);
	});
});
