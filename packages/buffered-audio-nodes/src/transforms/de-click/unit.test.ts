import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, notAnomalous } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { deClick } from ".";
import { mouthDeClick } from "./mouth-de-click";
import { deCrackle } from "./de-crackle";
import { arResidual, burgMethod, robustStd } from "./utils/ar-model";
import { bayesianThresholdFactor, clickPriorFromSensitivity, detectClicks, dilateMask, filterByDuration, perBandPriors, windowIndexForSample } from "./utils/click-detection";
import { bandBinGroups, splitByBinGroups } from "./utils/stft-bands";
import { groupContiguousGaps, lsarInterpolate } from "./utils/lsar";

const testVoice = audio.testVoice;

// ---------------------------------------------------------------------------
// AR model: Burg coefficients, residual, centred MAD.
// ---------------------------------------------------------------------------

describe("burgMethod / arResidual / robustStd", () => {
	it("throws when signal is shorter than order + 1", () => {
		expect(() => burgMethod(new Float32Array(5), 8)).toThrow();
	});

	it("returns zero coefficients on silent input", () => {
		const coeffs = burgMethod(new Float32Array(2048), 16);

		for (let i = 0; i < coeffs.length; i++) expect(coeffs[i]).toBe(0);
	});

	it("produces near-zero residual on a constant signal after the warm-up", () => {
		const n = 1024;
		const signal = new Float32Array(n);

		for (let i = 0; i < n; i++) signal[i] = 0.5;

		const order = 16;
		const coeffs = burgMethod(signal, order);
		const residual = arResidual(signal, coeffs);

		let maxAbs = 0;

		for (let i = order; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(residual[i] ?? 0));

		expect(maxAbs).toBeLessThan(1e-4);
	});

	it("recovers AR(2) coefficients within 2% on a synthetic AR(2) signal", () => {
		const a1True = -1.3;
		const a2True = 0.6;
		const n = 8192;
		const signal = new Float32Array(n);
		let seed = 1234567;
		const rand = (): number => {
			seed = (seed * 48271) % 2147483647;

			return (seed / 2147483647) * 2 - 1;
		};

		signal[0] = rand() * 0.01;
		signal[1] = rand() * 0.01;

		for (let i = 2; i < n; i++) {
			signal[i] = -a1True * (signal[i - 1] ?? 0) - a2True * (signal[i - 2] ?? 0) + rand() * 0.01;
		}

		const coeffs = burgMethod(signal, 2);

		expect(Math.abs((coeffs[0] ?? 0) - a1True)).toBeLessThan(0.02);
		expect(Math.abs((coeffs[1] ?? 0) - a2True)).toBeLessThan(0.02);
	});

	it("robustStd (centred MAD) is ~σ on Gaussian input and outlier-robust", () => {
		const n = 4096;
		const clean = new Float32Array(n);
		let seed = 42;
		const rand = (): number => {
			seed = (seed * 48271) % 2147483647;

			return (seed / 2147483647) * 2 - 1;
		};

		for (let i = 0; i < n; i++) {
			let s = 0;

			for (let k = 0; k < 12; k++) s += rand();

			clean[i] = s / Math.sqrt(12);
		}

		const sigmaClean = robustStd(clean);

		expect(sigmaClean).toBeGreaterThan(0);
		expect(Number.isFinite(sigmaClean)).toBe(true);

		const spiked = new Float32Array(clean);

		for (let i = 0; i < n; i += 50) spiked[i] = 100;

		const sigmaSpiked = robustStd(spiked);

		expect(Math.abs(sigmaSpiked - sigmaClean) / sigmaClean).toBeLessThan(0.2);
	});

	it("robustStd (centred MAD) subtracts the residual mean", () => {
		// Residual with a 10.0 DC offset but tight dispersion around it should
		// still report a small σ̂. The uncentred form would pick up the 10.0
		// offset and return ~14.826.
		const n = 1024;
		const biased = new Float32Array(n);
		let seed = 99;
		const rand = (): number => {
			seed = (seed * 48271) % 2147483647;

			return (seed / 2147483647) * 2 - 1;
		};

		for (let i = 0; i < n; i++) biased[i] = 10 + 0.1 * rand();

		const sigma = robustStd(biased);

		expect(sigma).toBeLessThan(0.2);
	});
});

// ---------------------------------------------------------------------------
// STFT bin-group decomposition.
// ---------------------------------------------------------------------------

describe("bandBinGroups", () => {
	it("matches the de-reverb band edges at fftSize=4096, sampleRate=48000", () => {
		const bands = bandBinGroups(4096, 48000);

		expect(bands.low[0]).toBe(0);
		expect(bands.lowMid[0]).toBe(Math.round(500 / (48000 / 4096)));
		expect(bands.highMid[0]).toBe(Math.round(2000 / (48000 / 4096)));
		expect(bands.high[0]).toBe(Math.round(8000 / (48000 / 4096)));
		expect(bands.high[1]).toBe(4096 / 2 + 1);
	});
});

describe("splitByBinGroups", () => {
	const sr = 48000;

	it("concentrates a 1 kHz sinusoid in the lowMid band", () => {
		const n = 4096;
		const signal = new Float32Array(n);

		for (let i = 0; i < n; i++) signal[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);

		const bands = splitByBinGroups(signal, sr, 2048, 512);
		const energy = (arr: Float32Array): number => {
			let e = 0;

			for (let i = 1024; i < n - 1024; i++) e += (arr[i] ?? 0) * (arr[i] ?? 0);

			return e;
		};
		const eLow = energy(bands.low);
		const eLowMid = energy(bands.lowMid);
		const eHighMid = energy(bands.highMid);
		const eHigh = energy(bands.high);
		const total = eLow + eLowMid + eHighMid + eHigh;

		expect(total).toBeGreaterThan(0);
		expect(eLowMid / total).toBeGreaterThan(0.9);
	});

	it("concentrates a 6 kHz sinusoid in the highMid band", () => {
		const n = 4096;
		const signal = new Float32Array(n);

		for (let i = 0; i < n; i++) signal[i] = Math.sin((2 * Math.PI * 6000 * i) / sr);

		const bands = splitByBinGroups(signal, sr, 2048, 512);
		const energy = (arr: Float32Array): number => {
			let e = 0;

			for (let i = 1024; i < n - 1024; i++) e += (arr[i] ?? 0) * (arr[i] ?? 0);

			return e;
		};
		const eLow = energy(bands.low);
		const eLowMid = energy(bands.lowMid);
		const eHighMid = energy(bands.highMid);
		const eHigh = energy(bands.high);
		const total = eLow + eLowMid + eHighMid + eHigh;

		expect(total).toBeGreaterThan(0);
		expect(eHighMid / total).toBeGreaterThan(0.9);
	});
});

// ---------------------------------------------------------------------------
// Bayesian threshold and per-band priors (G&R §5.3).
// ---------------------------------------------------------------------------

describe("clickPriorFromSensitivity", () => {
	it("maps sensitivity=1 to π=1e-2 (common-click regime)", () => {
		expect(clickPriorFromSensitivity(1)).toBeCloseTo(1e-2, 10);
	});

	it("maps sensitivity=0 to π=1e-6 (rare-click regime)", () => {
		expect(clickPriorFromSensitivity(0)).toBeCloseTo(1e-6, 10);
	});

	it("is log-linear in sensitivity", () => {
		// At sensitivity=0.5, π = 10^(-4) — log-linear midpoint of [10^-6, 10^-2].
		expect(clickPriorFromSensitivity(0.5)).toBeCloseTo(1e-4, 10);
	});
});

describe("bayesianThresholdFactor", () => {
	it("T(π=1e-2, K=100) ≈ 100/99·(ln100 + 2·ln99) ≈ 13.93", () => {
		const factor = bayesianThresholdFactor(1e-2);
		const expected = (100 / 99) * (Math.log(100) + 2 * Math.log(99));

		expect(factor).toBeCloseTo(expected, 6);
	});

	it("is monotonically decreasing in π (lower prior → higher threshold)", () => {
		const tLow = bayesianThresholdFactor(1e-6);
		const tHigh = bayesianThresholdFactor(1e-2);

		expect(tLow).toBeGreaterThan(tHigh);
	});
});

describe("perBandPriors", () => {
	it("is uniform at skew=0", () => {
		const pi = perBandPriors(1e-3, 0);

		expect(pi.low).toBeCloseTo(1e-3, 10);
		expect(pi.lowMid).toBeCloseTo(1e-3, 10);
		expect(pi.highMid).toBeCloseTo(1e-3, 10);
		expect(pi.high).toBeCloseTo(1e-3, 10);
	});

	it("biases high bands at skew=+1 by 2^3 = 8× over low bands", () => {
		const pi = perBandPriors(1e-4, 1);

		expect(pi.high / pi.low).toBeCloseTo(Math.pow(2, 3), 6);
	});

	it("mirrors at skew=-1", () => {
		const pi = perBandPriors(1e-4, -1);

		expect(pi.low / pi.high).toBeCloseTo(Math.pow(2, 3), 6);
	});
});

// ---------------------------------------------------------------------------
// LSAR interpolation (G&R §6.2).
// ---------------------------------------------------------------------------

describe("lsarInterpolate", () => {
	function fillAr2(signal: Float32Array, a1: number, a2: number, noiseAmp = 0.001): void {
		let seed = 314159;
		const rand = (): number => {
			seed = (seed * 48271) % 2147483647;

			return (seed / 2147483647) * 2 - 1;
		};

		signal[0] = rand() * 0.01;
		signal[1] = rand() * 0.01;

		for (let i = 2; i < signal.length; i++) {
			signal[i] = -a1 * (signal[i - 1] ?? 0) - a2 * (signal[i - 2] ?? 0) + rand() * noiseAmp;
		}
	}

	it("recovers an AR(2) sample within 5% of its true value when one sample is marked as a gap", () => {
		const n = 2048;
		const signal = new Float32Array(n);

		fillAr2(signal, -1.4, 0.5);

		const coeffs = new Float32Array([-1.4, 0.5]);
		const gapIndex = 1000;
		const trueValue = signal[gapIndex] ?? 0;

		signal[gapIndex] = 0;
		lsarInterpolate(signal, [gapIndex], coeffs);

		expect(Math.abs((signal[gapIndex] ?? 0) - trueValue)).toBeLessThan(0.05 * (Math.abs(trueValue) + 0.05));
	});

	it("handles a multi-sample gap and returns a non-zero reconstruction", () => {
		const n = 4096;
		const signal = new Float32Array(n);

		fillAr2(signal, -1.2, 0.4);

		const coeffs = burgMethod(signal, 8);
		const gap = [2000, 2001, 2002, 2003, 2004];

		for (const idx of gap) signal[idx] = 0;

		lsarInterpolate(signal, gap, coeffs);

		let sumAbs = 0;

		for (const idx of gap) sumAbs += Math.abs(signal[idx] ?? 0);

		expect(sumAbs).toBeGreaterThan(0);

		for (const idx of gap) expect(Number.isFinite(signal[idx] ?? NaN)).toBe(true);
	});

	it("is a no-op when the gap list is empty or coefficients are empty", () => {
		const signal = new Float32Array([1, 2, 3, 4, 5]);

		lsarInterpolate(signal, [], new Float32Array([-1, 0.5]));
		expect(Array.from(signal)).toEqual([1, 2, 3, 4, 5]);

		lsarInterpolate(signal, [2], new Float32Array());
		expect(Array.from(signal)).toEqual([1, 2, 3, 4, 5]);
	});

	it("skips gap indices that lack enough history for the AR model", () => {
		const signal = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const coeffs = new Float32Array([-0.5, 0.25, -0.1]);

		// Index 1 has only one sample of history (< order = 3); skipped.
		lsarInterpolate(signal, [1], coeffs);
		expect(signal[1]).toBe(2);
	});
});

describe("groupContiguousGaps", () => {
	it("splits disjoint runs", () => {
		const groups = groupContiguousGaps([1, 2, 3, 10, 11, 20]);

		expect(groups).toEqual([
			[1, 2, 3],
			[10, 11],
			[20],
		]);
	});

	it("returns empty for an empty input", () => {
		expect(groupContiguousGaps([])).toEqual([]);
	});

	it("sorts unsorted input", () => {
		const groups = groupContiguousGaps([5, 4, 3, 10]);

		expect(groups).toEqual([
			[3, 4, 5],
			[10],
		]);
	});
});

// ---------------------------------------------------------------------------
// End-to-end detection behaviour.
// ---------------------------------------------------------------------------

function makeNoiseThenSpikes(frames: number, spikeIndices: readonly number[], spikeAmp = 0.9): Float32Array {
	const out = new Float32Array(frames);
	let seed = 13579;

	for (let i = 0; i < frames; i++) {
		seed = (seed * 48271) % 2147483647;
		out[i] = ((seed / 2147483647) * 2 - 1) * 0.02;
	}

	for (const idx of spikeIndices) {
		if (idx >= 0 && idx < frames) out[idx] = spikeAmp;
	}

	return out;
}

function maskAnyInRange(mask: Uint8Array, start: number, end: number): boolean {
	for (let i = Math.max(0, start); i < Math.min(mask.length, end); i++) {
		if ((mask[i] ?? 0) > 0) return true;
	}

	return false;
}

function maskCount(mask: Uint8Array): number {
	let total = 0;

	for (let i = 0; i < mask.length; i++) total += mask[i] ?? 0;

	return total;
}

describe("detectClicks", () => {
	const sr = 48000;

	it("detects an injected spike on a noisy background", () => {
		const frames = 16384;
		const spikeAt = 8000;
		const signal = makeNoiseThenSpikes(frames, [spikeAt]);
		const { mask } = detectClicks(signal, sr, { sensitivity: 0.7, frequencySkew: 0, fftSize: 2048, hopSize: 512 });

		expect(maskAnyInRange(mask, spikeAt - 4, spikeAt + 5)).toBe(true);
	});

	it("returns a near-empty mask on a predictable pure tone", () => {
		const frames = 16384;
		const signal = new Float32Array(frames);

		for (let i = 0; i < frames; i++) signal[i] = 0.3 * Math.sin((2 * Math.PI * 1000 * i) / sr);

		const { mask } = detectClicks(signal, sr, { sensitivity: 0.5, frequencySkew: 0, fftSize: 2048, hopSize: 512 });

		// A sustained sinusoid is highly AR-predictable at order ~50 — expect
		// < 1% of samples marked even at moderate sensitivity.
		expect(maskCount(mask)).toBeLessThan(Math.floor(frames * 0.01));
	});

	it("returns an all-zero mask on silence", () => {
		const { mask } = detectClicks(new Float32Array(16384), sr, { sensitivity: 0.5, frequencySkew: 0, fftSize: 2048, hopSize: 512 });

		expect(maskCount(mask)).toBe(0);
	});

	it("produces per-window AR coefficients of length order = round(sampleRate/1000) + 2", () => {
		const frames = 16384;
		const signal = makeNoiseThenSpikes(frames, [8000]);
		const result = detectClicks(signal, sr, { sensitivity: 0.5, frequencySkew: 0, fftSize: 2048, hopSize: 512 });

		const expectedOrder = Math.round(sr / 1000) + 2;

		expect(result.windowCoefficients.length).toBe(result.numWindows);

		for (const coeffs of result.windowCoefficients) {
			expect(coeffs.length).toBe(expectedOrder);
		}
	});
});

// ---------------------------------------------------------------------------
// Mask post-processing.
// ---------------------------------------------------------------------------

describe("dilateMask", () => {
	it("is the identity at half-width 0", () => {
		const mask = new Uint8Array([0, 0, 1, 0, 0]);

		expect(Array.from(dilateMask(mask, 0))).toEqual([0, 0, 1, 0, 0]);
	});

	it("extends an isolated hit by halfWidth on each side", () => {
		const mask = new Uint8Array(10);

		mask[5] = 1;

		expect(Array.from(dilateMask(mask, 2))).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 0, 0]);
	});

	it("clamps to array boundaries", () => {
		const mask = new Uint8Array(5);

		mask[0] = 1;
		mask[4] = 1;

		expect(Array.from(dilateMask(mask, 3))).toEqual([1, 1, 1, 1, 1]);
	});

	it("merges overlapping dilated regions", () => {
		const mask = new Uint8Array(10);

		mask[2] = 1;
		mask[6] = 1;

		expect(Array.from(dilateMask(mask, 3))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
	});
});

describe("filterByDuration", () => {
	it("clears regions longer than the maximum", () => {
		const mask = new Uint8Array([0, 1, 1, 1, 1, 1, 0, 1, 0]);

		filterByDuration(mask, 3);

		expect(Array.from(mask)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0]);
	});

	it("keeps regions at exactly the duration limit", () => {
		const mask = new Uint8Array([1, 1, 1, 0]);

		filterByDuration(mask, 3);

		expect(Array.from(mask)).toEqual([1, 1, 1, 0]);
	});
});

describe("windowIndexForSample", () => {
	it("returns 0 for the first window", () => {
		expect(windowIndexForSample(10, 1920, 960, 10)).toBe(0);
	});

	it("returns an index in range for a late sample", () => {
		const numWindows = 10;
		const index = windowIndexForSample(5000, 1920, 960, numWindows);

		expect(index).toBeGreaterThanOrEqual(0);
		expect(index).toBeLessThan(numWindows);
	});
});

// ---------------------------------------------------------------------------
// Presets.
// ---------------------------------------------------------------------------

describe("mouthDeClick preset", () => {
	it("applies mouth-tuned defaults", () => {
		const node = mouthDeClick();

		expect(node.properties.sensitivity).toBe(0.7);
		expect(node.properties.frequencySkew).toBe(0.3);
		expect(node.properties.clickWidening).toBe(0.5);
		expect(node.properties.maxClickDuration).toBe(50);
	});

	it("accepts overrides", () => {
		const node = mouthDeClick({ sensitivity: 0.4, frequencySkew: -0.2, clickWidening: 0.3, maxClickDuration: 25 });

		expect(node.properties.sensitivity).toBe(0.4);
		expect(node.properties.frequencySkew).toBe(-0.2);
		expect(node.properties.clickWidening).toBe(0.3);
		expect(node.properties.maxClickDuration).toBe(25);
	});
});

describe("deCrackle preset", () => {
	it("applies crackle-tuned defaults", () => {
		const node = deCrackle();

		expect(node.properties.sensitivity).toBe(0.5);
		expect(node.properties.frequencySkew).toBe(0);
		expect(node.properties.clickWidening).toBe(0.1);
		expect(node.properties.maxClickDuration).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// End-to-end integration.
// ---------------------------------------------------------------------------

describe("DeClick integration", () => {
	it("passes clean voice audio through without introducing anomalies", async () => {
		// With default sensitivity (0.5 → π = 1e-4 → T ≈ 20σ) on clean voice
		// there are effectively no samples whose residual exceeds the
		// Bayesian threshold — the correct faithful-G&R behaviour is to
		// produce output equal (or near-equal) to input. This is the
		// regression check for the prior shipped code, which low-pass-ducked
		// every voiced segment.
		const transform = deClick();
		const { output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);

});
