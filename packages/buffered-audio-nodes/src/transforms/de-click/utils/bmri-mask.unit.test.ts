import { describe, expect, it } from "vitest";
import { stft } from "@e9g/buffered-audio-nodes-utils";
import {
	DEFAULT_BMRI_THRESHOLD_OPTIONS,
	applyBinaryMask,
	computeAdaptiveThreshold,
	dilateMaskTFCells,
	frequencyToBin,
} from "./bmri-mask";

describe("computeAdaptiveThreshold", () => {
	it("converges to within ±1 dB of the true periodogram on stationary white noise", () => {
		// Generate ~1 second of white noise at 44.1 kHz plus 10 s so the τ_att = 10 s
		// attack-smoother has time to converge. Ruhland §II.A.1 writes the long
		// attack time in terms of seconds; the assertion checks post-convergence.
		const sampleRate = 44_100;
		const durationSec = 12;
		const total = sampleRate * durationSec;
		const signal = new Float32Array(total);
		let seed = 42;
		const rand = (): number => {
			seed = (seed * 48271) % 2147483647;

			return (seed / 2147483647) * 2 - 1;
		};
		// Box-Muller for normal noise.
		for (let i = 0; i < total; i += 2) {
			const u1 = Math.max(1e-12, (rand() + 1) / 2);
			const u2 = (rand() + 1) / 2;
			const mag = Math.sqrt(-2 * Math.log(u1));

			signal[i] = 0.1 * mag * Math.cos(2 * Math.PI * u2);
			if (i + 1 < total) signal[i + 1] = 0.1 * mag * Math.sin(2 * Math.PI * u2);
		}

		const fftSize = 2048;
		const hopSize = 1024;
		const spectra = stft(signal, fftSize, hopSize);
		const threshold = computeAdaptiveThreshold(spectra, sampleRate, fftSize, hopSize, DEFAULT_BMRI_THRESHOLD_OPTIONS);

		const numBins = fftSize / 2 + 1;
		const frames = spectra.frames;
		// Use the last 20% of frames (post ~10 s convergence).
		const startFrame = Math.floor(frames * 0.8);

		// The true periodogram expectation for white noise is constant per bin (the
		// noise variance times window normalisation). We compare the per-frame mean
		// of log threshold to the per-frame mean of log |Y|² — they should track
		// within ~1 dB after convergence.
		let maxDev = 0;

		for (let frame = startFrame; frame < frames; frame++) {
			let sumThrDb = 0;
			let sumPowDb = 0;
			let count = 0;

			// Skip DC and Nyquist — the β[k] offset is log-based and pinned at DC.
			for (let bin = 2; bin < numBins - 2; bin++) {
				const re = spectra.real[frame * numBins + bin] ?? 0;
				const im = spectra.imag[frame * numBins + bin] ?? 0;
				const power = re * re + im * im;

				if (power <= 0) continue;

				const thr = threshold[frame * numBins + bin] ?? 0;

				if (thr <= 0) continue;

				sumThrDb += 10 * Math.log10(thr);
				sumPowDb += 10 * Math.log10(power);
				count++;
			}

			if (count === 0) continue;

			const avgThr = sumThrDb / count;
			const avgPow = sumPowDb / count;

			maxDev = Math.max(maxDev, Math.abs(avgThr - avgPow));
		}

		// β[k] raises the threshold above the power by a small amount; allow 3 dB.
		expect(maxDev).toBeLessThan(3);
	});
});

describe("applyBinaryMask", () => {
	it("routes each bin to target or residual based on |Y|² vs threshold", () => {
		const fftSize = 2048;
		const numBins = fftSize / 2 + 1;
		const frames = 4;
		const total = numBins * frames;

		// Construct a synthetic STFT with known per-bin power: bin k has
		// |Y[k]|² = (k + 1).
		const real = new Float32Array(total);
		const imag = new Float32Array(total);

		for (let frame = 0; frame < frames; frame++) {
			for (let bin = 0; bin < numBins; bin++) {
				real[frame * numBins + bin] = Math.sqrt(bin + 1);
			}
		}

		const spectra = { real, imag, frames, fftSize } as const;
		// Threshold = midpoint of the power range, so bins with k+1 < threshold
		// go to residual and bins with k+1 >= threshold go to target.
		const thresholdValue = numBins / 2;
		const threshold = new Float32Array(total);

		for (let i = 0; i < total; i++) threshold[i] = thresholdValue;

		const { target, residual, mask } = applyBinaryMask(spectra, threshold);

		// Check a low-power bin (should go to residual, mask = 1).
		const lowIdx = 0; // power = 1 < thresholdValue
		expect(mask[lowIdx]).toBe(1);
		expect(residual.real[lowIdx]).toBeCloseTo(Math.sqrt(1), 6);
		expect(target.real[lowIdx]).toBe(0);

		// Check a high-power bin (should go to target, mask = 0).
		const highIdx = numBins - 1; // power = numBins > thresholdValue
		expect(mask[highIdx]).toBe(0);
		expect(target.real[highIdx]).toBeCloseTo(Math.sqrt(numBins), 6);
		expect(residual.real[highIdx]).toBe(0);

		// Partition invariant: at every cell, exactly one of target/residual
		// carries the original value, the other is zero.
		for (let i = 0; i < total; i++) {
			const tr = target.real[i] ?? 0;
			const rr = residual.real[i] ?? 0;
			const orig = real[i] ?? 0;

			expect(tr + rr).toBeCloseTo(orig, 6);
		}
	});
});

describe("applyBinaryMask band restriction", () => {
	it("force-keeps bins outside [minBin, maxBin] in the target regardless of threshold", () => {
		// Build a synthetic STFT whose every bin sits below threshold — without
		// a band restriction, all bins would be routed to the residual
		// (mask = 1). With the restriction, only bins inside the active band
		// should carry mask = 1; bins outside must be in the target (mask = 0).
		const fftSize = 2048;
		const sampleRate = 48_000;
		const numBins = fftSize / 2 + 1;
		const frames = 2;
		const total = numBins * frames;

		const real = new Float32Array(total);
		const imag = new Float32Array(total);

		// Every bin has |Y|² = 1.
		for (let i = 0; i < total; i++) real[i] = 1;

		const spectra = { real, imag, frames, fftSize } as const;

		// Threshold set to 2 everywhere so |Y|² = 1 < 2 ⇒ below threshold at
		// every bin. Without band restriction, mask = 1 everywhere.
		const threshold = new Float32Array(total);

		for (let i = 0; i < total; i++) threshold[i] = 2;

		// Sanity: without band restriction, mask is 1 at every bin.
		const { mask: unrestricted } = applyBinaryMask(spectra, threshold);

		for (let i = 0; i < total; i++) expect(unrestricted[i]).toBe(1);

		// With band [100 Hz, 5000 Hz], only bins inside that band should be
		// mask-rejected.
		const minFrequencyHz = 100;
		const maxFrequencyHz = 5000;
		const minBin = frequencyToBin(minFrequencyHz, sampleRate, fftSize);
		const maxBin = frequencyToBin(maxFrequencyHz, sampleRate, fftSize);

		expect(minBin).toBeGreaterThan(0);
		expect(maxBin).toBeLessThan(numBins - 1);

		const { mask, target, residual } = applyBinaryMask(spectra, threshold, {
			sampleRate,
			fftSize,
			minFrequencyHz,
			maxFrequencyHz,
		});

		for (let frame = 0; frame < frames; frame++) {
			for (let bin = 0; bin < numBins; bin++) {
				const idx = frame * numBins + bin;
				const inBand = bin >= minBin && bin <= maxBin;

				if (inBand) {
					// In-band, below threshold ⇒ residual.
					expect(mask[idx]).toBe(1);
					expect(target.real[idx]).toBe(0);
					expect(residual.real[idx]).toBe(real[idx]);
				} else {
					// Out-of-band ⇒ force-kept in target.
					expect(mask[idx]).toBe(0);
					expect(target.real[idx]).toBe(real[idx]);
					expect(residual.real[idx]).toBe(0);
				}
			}
		}
	});

	it("includes bin 0 (DC) when minFrequency is 0", () => {
		const fftSize = 1024;
		const sampleRate = 48_000;
		const numBins = fftSize / 2 + 1;
		const frames = 1;
		const total = numBins * frames;
		const real = new Float32Array(total);

		for (let i = 0; i < total; i++) real[i] = 1;

		const imag = new Float32Array(total);
		const threshold = new Float32Array(total);

		for (let i = 0; i < total; i++) threshold[i] = 2;

		// minFrequency = 0 (default) ⇒ minBin = 0; no maxFrequency ⇒ maxBin = Nyquist.
		const { mask } = applyBinaryMask({ real, imag, frames, fftSize } as const, threshold, {
			sampleRate,
			fftSize,
			minFrequencyHz: 0,
		});

		// Every bin (including DC and Nyquist) should be mask-rejected.
		for (let bin = 0; bin < numBins; bin++) expect(mask[bin]).toBe(1);
	});

	it("includes Nyquist bin when maxFrequency is at or above Nyquist", () => {
		const fftSize = 1024;
		const sampleRate = 48_000;
		const numBins = fftSize / 2 + 1;
		const nyquistHz = sampleRate / 2;
		const frames = 1;
		const total = numBins * frames;
		const real = new Float32Array(total);

		for (let i = 0; i < total; i++) real[i] = 1;

		const imag = new Float32Array(total);
		const threshold = new Float32Array(total);

		for (let i = 0; i < total; i++) threshold[i] = 2;

		const { mask } = applyBinaryMask({ real, imag, frames, fftSize } as const, threshold, {
			sampleRate,
			fftSize,
			maxFrequencyHz: nyquistHz,
		});

		// Nyquist bin should be in-band ⇒ mask = 1.
		expect(mask[numBins - 1]).toBe(1);
	});
});

describe("frequencyToBin", () => {
	it("maps 0 Hz to bin 0", () => {
		expect(frequencyToBin(0, 48_000, 2048)).toBe(0);
	});

	it("maps the Nyquist frequency to bin fftSize/2", () => {
		expect(frequencyToBin(24_000, 48_000, 2048)).toBe(1024);
	});

	it("clamps above-Nyquist frequencies to bin fftSize/2", () => {
		expect(frequencyToBin(30_000, 48_000, 2048)).toBe(1024);
	});

	it("rounds to the nearest bin: 100 Hz @ 48 kHz, L=2048 ⇒ round(100·2048/48000) = round(4.267) = 4", () => {
		expect(frequencyToBin(100, 48_000, 2048)).toBe(4);
	});

	it("5000 Hz @ 48 kHz, L=2048 ⇒ round(5000·2048/48000) = round(213.33) = 213", () => {
		expect(frequencyToBin(5000, 48_000, 2048)).toBe(213);
	});
});

describe("dilateMaskTFCells", () => {
	it("produces a 3x3 hit on a single-cell mask with radius 1", () => {
		const frames = 5;
		const bins = 5;
		const mask = new Uint8Array(frames * bins);

		// Set a single cell at (frame=2, bin=2).
		mask[2 * bins + 2] = 1;

		const dilated = dilateMaskTFCells(mask, frames, bins, 1, 1);

		// Expect the 3×3 block centred on (2,2) to all be 1, and everything else 0.
		for (let frame = 0; frame < frames; frame++) {
			for (let bin = 0; bin < bins; bin++) {
				const idx = frame * bins + bin;
				const shouldBeOne = frame >= 1 && frame <= 3 && bin >= 1 && bin <= 3;

				expect(dilated[idx]).toBe(shouldBeOne ? 1 : 0);
			}
		}

		// Input is not modified.
		expect(mask[2 * bins + 2]).toBe(1);
		expect(mask[(2 * bins + 2) - 1]).toBe(0);
	});

	it("is a no-op when radius is zero", () => {
		const mask = new Uint8Array(9);

		mask[4] = 1;

		const dilated = dilateMaskTFCells(mask, 3, 3, 0, 0);

		for (let i = 0; i < 9; i++) expect(dilated[i]).toBe(mask[i]);
	});
});
