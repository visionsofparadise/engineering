import { describe, expect, it } from "vitest";
import { istft, stft, type StftResult } from "@e9g/buffered-audio-nodes-utils";
import { spectralCorrectAndRecombine } from "./bmri-recombine";

function makeZeroStft(fftSize: number, frames: number): StftResult {
	const numBins = fftSize / 2 + 1;

	return {
		real: new Float32Array(numBins * frames),
		imag: new Float32Array(numBins * frames),
		frames,
		fftSize,
	};
}

function cloneStft(s: StftResult): StftResult {
	return {
		real: new Float32Array(s.real),
		imag: new Float32Array(s.imag),
		frames: s.frames,
		fftSize: s.fftSize,
	};
}

describe("spectralCorrectAndRecombine", () => {
	const fftSize = 2048;
	const hopSize = 1024;
	const sampleRate = 44_100;
	const outputLength = sampleRate; // 1 s.

	it("mask all-zero → output equals iSTFT of target alone", () => {
		// Synthetic input: a 440 Hz sine.
		const signal = new Float32Array(outputLength);

		for (let i = 0; i < outputLength; i++) {
			signal[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
		}

		const target = stft(signal, fftSize, hopSize);
		const numBins = fftSize / 2 + 1;
		const mask = new Uint8Array(numBins * target.frames); // all zeros → everything kept in target
		const residualInterpolated = makeZeroStft(fftSize, target.frames);

		const restored = spectralCorrectAndRecombine(
			cloneStft(target),
			residualInterpolated,
			mask,
			fftSize,
			hopSize,
			outputLength,
		);
		const targetTime = istft(cloneStft(target), hopSize, outputLength);

		let maxDiff = 0;

		for (let i = 0; i < outputLength; i++) {
			maxDiff = Math.max(maxDiff, Math.abs((restored[i] ?? 0) - (targetTime[i] ?? 0)));
		}

		expect(maxDiff).toBeLessThan(1e-5);
	});

	it("mask all-one + zero residual → output is ~all zeros", () => {
		const target = makeZeroStft(fftSize, 8);
		const residualInterpolated = makeZeroStft(fftSize, 8);
		const numBins = fftSize / 2 + 1;
		const mask = new Uint8Array(numBins * 8);

		for (let i = 0; i < mask.length; i++) mask[i] = 1;

		const restored = spectralCorrectAndRecombine(target, residualInterpolated, mask, fftSize, hopSize, outputLength);
		let maxAbs = 0;

		for (let i = 0; i < outputLength; i++) maxAbs = Math.max(maxAbs, Math.abs(restored[i] ?? 0));

		expect(maxAbs).toBeLessThan(1e-9);
	});

	it("zeroes residual bins where mask === 0 (spectral correction)", () => {
		// Build a zero target and a residual with nonzero bins at a cell where
		// mask is zero. After correction, that cell is zeroed in R̃.
		const frames = 4;
		const numBins = fftSize / 2 + 1;
		const target = makeZeroStft(fftSize, frames);
		const residualInterpolated = makeZeroStft(fftSize, frames);
		const mask = new Uint8Array(numBins * frames); // all zeros: mask-kept everywhere.

		// Put a non-zero value into residual at (frame=1, bin=10) — where mask === 0.
		const idx = 1 * numBins + 10;

		residualInterpolated.real[idx] = 1.5;
		residualInterpolated.imag[idx] = -0.7;

		// Put another non-zero value at (frame=2, bin=20) where we will set mask === 1.
		const idx2 = 2 * numBins + 20;

		residualInterpolated.real[idx2] = 0.3;
		residualInterpolated.imag[idx2] = 0.4;
		mask[idx2] = 1;

		spectralCorrectAndRecombine(target, residualInterpolated, mask, fftSize, hopSize, outputLength);

		// After the call, the residualInterpolated mutation has zeroed (1, 10) and
		// preserved (2, 20).
		expect(residualInterpolated.real[idx]).toBe(0);
		expect(residualInterpolated.imag[idx]).toBe(0);
		expect(residualInterpolated.real[idx2]).toBeCloseTo(0.3, 6);
		expect(residualInterpolated.imag[idx2]).toBeCloseTo(0.4, 6);
	});
});
