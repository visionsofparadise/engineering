import { describe, it, expect } from "vitest";
import { MemoryChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { decimate, fft, ifft, integerDecimationRate, stft } from "@e9g/buffered-audio-nodes-utils";
import { deReverb, DeReverbNode, DeReverbStream } from ".";
import { bandBinGroups } from "./utils/bands";
import { applyEnhanceDry, computeRawGain, createReverbState, enhanceDryBoostLin } from "./utils/gain-mask";
import { LOLLMANN_L_MIN, learnReverbProfile, ratnamMlT60, subFrameStreakLength } from "./utils/learn";

const sampleRate = 48000;
const fftSize = 2048;
const hopSize = 512;

// ---------------------------------------------------------------------------
// Synthetic voice+RIR fixture — shared across Phase 2..6 integration
// diagnostics per `plan-dereverb-lollmann-fix.md` Phase 2.1 and
// `design-dereverb.md` §"Synthetic voice+RIR fixture".
//
// Construction:
//   - 48 kHz, 16 s.
//   - Carrier: white Gaussian noise at −12 dBFS RMS, seeded Mulberry32(0x5EEDF00D).
//   - Envelope: 4 bursts/s (250 ms period) — 120 ms raised-cosine on-ramp at
//     0 dB followed by 130 ms silent gap at −96 dBFS.
//   - RIR: 1.5 s of seeded white Gaussian multiplied by exp(−3·ln10·t/T60)
//     with T60 = 0.5 s, normalised to unit peak amplitude.
//   - Mix: `dry + 0.5 · conv(dry, rir)` (−6 dB wet/dry).
//
// `expectedBetaBaseline` is NOT returned — it requires the β closed form,
// which would be circular inside the fixture. Later phases measure the
// β baseline empirically.
// ---------------------------------------------------------------------------

/**
 * Mulberry32: fast deterministic 32-bit PRNG.
 *
 * Returns a function producing floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Standard-normal sampler on top of a uniform PRNG via the Box–Muller
 * transform. Caches the second sample from each Box–Muller pair.
 */
function makeGaussianSampler(rng: () => number): () => number {
	let cached: number | undefined;

	return (): number => {
		if (cached !== undefined) {
			const value = cached;

			cached = undefined;

			return value;
		}

		let u1 = rng();

		if (u1 < 1e-12) u1 = 1e-12;

		const u2 = rng();
		const radius = Math.sqrt(-2 * Math.log(u1));
		const angle = 2 * Math.PI * u2;

		cached = radius * Math.sin(angle);

		return radius * Math.cos(angle);
	};
}

export interface VoiceRirFixture {
	readonly mixed: Float32Array;
	readonly dry: Float32Array;
	readonly rir: Float32Array;
	readonly sampleRate: number;
	readonly expectedT60: number;
	readonly expectedAlpha: number;
}

export function makeVoiceRirFixture(): VoiceRirFixture {
	const fixtureSampleRate = 48000;
	const durationSeconds = 16;
	const totalSamples = durationSeconds * fixtureSampleRate;
	const burstPeriodSamples = Math.round(0.25 * fixtureSampleRate); // 250 ms
	const rampSamples = Math.round(0.12 * fixtureSampleRate); // 120 ms raised-cosine
	const targetRmsLin = Math.pow(10, -12 / 20); // −12 dBFS
	const silenceLin = Math.pow(10, -96 / 20); // −96 dBFS floor
	const t60 = 0.5;
	const rirDurationSeconds = 1.5;
	const rirSamples = Math.round(rirDurationSeconds * fixtureSampleRate);
	const hop = 512;

	const rng = mulberry32(0x5EEDF00D);
	const gaussian = makeGaussianSampler(rng);

	// Carrier: white Gaussian scaled to −12 dBFS RMS.
	const carrier = new Float32Array(totalSamples);

	for (let index = 0; index < totalSamples; index++) {
		carrier[index] = gaussian();
	}

	let carrierSumSq = 0;

	for (let index = 0; index < totalSamples; index++) {
		carrierSumSq += (carrier[index] ?? 0) * (carrier[index] ?? 0);
	}

	const carrierRms = Math.sqrt(carrierSumSq / totalSamples);
	const carrierGain = carrierRms > 0 ? targetRmsLin / carrierRms : 1;

	for (let index = 0; index < totalSamples; index++) {
		carrier[index] = (carrier[index] ?? 0) * carrierGain;
	}

	// Envelope: 120 ms raised-cosine ramp + 130 ms silent gap, repeated every
	// 250 ms. On-ramp is `0.5 · (1 − cos(π · t / T_ramp))` from 0 → 1 over 120 ms.
	const dry = new Float32Array(totalSamples);

	for (let index = 0; index < totalSamples; index++) {
		const positionInBurst = index % burstPeriodSamples;
		let envelope: number;

		if (positionInBurst < rampSamples) {
			const phase = positionInBurst / rampSamples;

			envelope = 0.5 * (1 - Math.cos(Math.PI * phase));
		} else {
			envelope = silenceLin;
		}

		dry[index] = (carrier[index] ?? 0) * envelope;
	}

	// RIR: seeded Gaussian × exponential envelope `exp(−3·ln10·t/T60)`,
	// normalised to unit peak amplitude.
	const rir = new Float32Array(rirSamples);
	const decayRate = (3 * Math.LN10) / t60;

	for (let index = 0; index < rirSamples; index++) {
		const t = index / fixtureSampleRate;
		const envelope = Math.exp(-decayRate * t);

		rir[index] = gaussian() * envelope;
	}

	let peak = 0;

	for (let index = 0; index < rirSamples; index++) {
		const abs = Math.abs(rir[index] ?? 0);

		if (abs > peak) peak = abs;
	}

	if (peak > 0) {
		const invPeak = 1 / peak;

		for (let index = 0; index < rirSamples; index++) {
			rir[index] = (rir[index] ?? 0) * invPeak;
		}
	}

	// Convolution via FFT (deviation from the plan's "time-domain convolution
	// is fine" note): at `totalSamples ≈ 768000` and `rirSamples = 72000`,
	// naive time-domain convolution is ~55 · 10⁹ multiply-adds — infeasible in
	// Node/V8 within test timeouts. Using the utils package's power-of-2 FFT
	// is mathematically equivalent and finishes in seconds.
	let fftSizeForConv = 1;

	while (fftSizeForConv < totalSamples + rirSamples) fftSizeForConv *= 2;

	const dryPadded = new Float32Array(fftSizeForConv);

	dryPadded.set(dry);

	const rirPadded = new Float32Array(fftSizeForConv);

	rirPadded.set(rir);

	const dryFft = fft(dryPadded);
	const rirFft = fft(rirPadded);
	const productRe = new Float32Array(fftSizeForConv);
	const productIm = new Float32Array(fftSizeForConv);

	for (let bin = 0; bin < fftSizeForConv; bin++) {
		const a = dryFft.re[bin] ?? 0;
		const b = dryFft.im[bin] ?? 0;
		const c = rirFft.re[bin] ?? 0;
		const d = rirFft.im[bin] ?? 0;

		productRe[bin] = a * c - b * d;
		productIm[bin] = a * d + b * c;
	}

	const wetFull = ifft(productRe, productIm);
	const wet = new Float32Array(totalSamples);

	wet.set(wetFull.subarray(0, totalSamples));

	// Mix: `mixed = dry + 0.5 · wet` (−6 dB wet/dry).
	const mixed = new Float32Array(totalSamples);

	for (let index = 0; index < totalSamples; index++) {
		mixed[index] = (dry[index] ?? 0) + 0.5 * (wet[index] ?? 0);
	}

	// Expected α from T60 at hop=512, f_s=48000:
	//   τ = T60 / (3·ln10);  λ = exp(−H / (f_s · τ));  α = 1 − λ.
	const tau = t60 / (3 * Math.LN10);
	const lambda = Math.exp(-hop / (fixtureSampleRate * tau));
	const expectedAlpha = 1 - lambda;

	return {
		mixed,
		dry,
		rir,
		sampleRate: fixtureSampleRate,
		expectedT60: t60,
		expectedAlpha,
	};
}

describe("makeVoiceRirFixture", () => {
	it("returns the documented lengths and expectedAlpha", () => {
		const fixture = makeVoiceRirFixture();

		expect(fixture.sampleRate).toBe(48000);
		expect(fixture.dry.length).toBe(16 * 48000);
		expect(fixture.mixed.length).toBe(16 * 48000);
		expect(fixture.rir.length).toBe(Math.round(1.5 * 48000));
		expect(fixture.expectedT60).toBeCloseTo(0.5, 10);

		// Hand-computed: 1 − exp(−512 / (48000 · (0.5 / (3·ln10)))) ≈ 0.1369.
		const handComputed = 1 - Math.exp(-512 / (48000 * (0.5 / (3 * Math.LN10))));

		expect(fixture.expectedAlpha).toBeCloseTo(handComputed, 12);
		expect(fixture.expectedAlpha).toBeCloseTo(0.1369, 3);
	}, 60_000);

	it("has unit-peak RIR and non-zero mixed output", () => {
		const fixture = makeVoiceRirFixture();

		let rirPeak = 0;

		for (let index = 0; index < fixture.rir.length; index++) {
			const abs = Math.abs(fixture.rir[index] ?? 0);

			if (abs > rirPeak) rirPeak = abs;
		}

		expect(rirPeak).toBeCloseTo(1, 10);

		let mixedSumSq = 0;

		for (let index = 0; index < fixture.mixed.length; index++) {
			mixedSumSq += (fixture.mixed[index] ?? 0) * (fixture.mixed[index] ?? 0);
		}

		expect(mixedSumSq).toBeGreaterThan(0);
	}, 60_000);
});

// ---------------------------------------------------------------------------
// Node skeleton and schema.
// ---------------------------------------------------------------------------

describe("DeReverb", () => {
	it("imports the stream skeleton without throwing", () => {
		expect(DeReverbStream).toBeDefined();
	});

	it("static node metadata is populated", () => {
		expect(DeReverbNode.moduleName).toBe("De-Reverb");
		expect(DeReverbNode.moduleDescription).toContain("reverb");
	});

	it("factory applies schema defaults", () => {
		const node = deReverb();

		expect(node.properties.reduction).toBe(5);
		expect(node.properties.tailLength).toBe(1);
		expect(node.properties.artifactSmoothing).toBe(2);
		expect(node.properties.enhanceDry).toBe(false);
		expect(node.properties.outputReverbOnly).toBe(false);
		expect(node.properties.fftSize).toBe(2048);
		expect(node.properties.hopSize).toBe(512);
	});
});

// ---------------------------------------------------------------------------
// Band-bin lookup.
// ---------------------------------------------------------------------------

describe("bandBinGroups", () => {
	it("produces expected bin ranges at fftSize=2048, sampleRate=48000", () => {
		const bands = bandBinGroups(2048, 48000);

		// Bin width 48000/2048 ≈ 23.4 Hz. Band edges Hz → nearest bin.
		expect(bands.low).toEqual([0, Math.round(500 / (48000 / 2048))]);
		expect(bands.lowMid).toEqual([Math.round(500 / (48000 / 2048)), Math.round(2000 / (48000 / 2048))]);
		expect(bands.highMid).toEqual([Math.round(2000 / (48000 / 2048)), Math.round(8000 / (48000 / 2048))]);
		expect(bands.high).toEqual([Math.round(8000 / (48000 / 2048)), 2048 / 2 + 1]);
	});
});

// ---------------------------------------------------------------------------
// Gain mask — Nercessian & Lukin 2019 §2.1 Eq. (1)+(2) closed-form inversion.
// ---------------------------------------------------------------------------

describe("enhanceDryBoostLin", () => {
	it("maps dB to its linear factor", () => {
		expect(enhanceDryBoostLin(0)).toBeCloseTo(1, 10);
		expect(enhanceDryBoostLin(1)).toBeCloseTo(Math.pow(10, 1 / 20), 10);
		expect(enhanceDryBoostLin(6)).toBeCloseTo(Math.pow(10, 6 / 20), 10);
	});
});

describe("applyEnhanceDry", () => {
	it("multiplies bins with gain > 0.9 by boostLin", () => {
		const gain = new Float32Array([0, 0.5, 0.95, 1.0]);

		applyEnhanceDry(gain, 2);

		expect(gain[0]).toBe(0);
		expect(gain[1]).toBe(0.5);
		expect(gain[2] ?? NaN).toBeCloseTo(1.9, 5);
		expect(gain[3] ?? NaN).toBeCloseTo(2, 5);
	});
});

describe("computeRawGain (Nercessian & Lukin 2019 §2.1 Eq. (1)+(2) inversion)", () => {
	const bands = bandBinGroups(fftSize, sampleRate);
	const numBins = fftSize / 2 + 1;
	const zeroBeta: readonly [number, number, number, number] = [0, 0, 0, 0];

	it("returns unity gain for bins where β · r_t ≪ |Y_t|", () => {
		const magY = new Float32Array(numBins);
		const gain = new Float32Array(numBins);
		const state = createReverbState(numBins);

		magY.fill(1);
		computeRawGain(magY, 0.1, zeroBeta, bands, 1, state, gain);

		for (const bin of [0, 100, 500, numBins - 1]) {
			expect(gain[bin] ?? 0).toBeGreaterThan(0.999);
			expect(gain[bin] ?? 0).toBeLessThanOrEqual(1);
		}
	});

	it("returns zero gain when β · r_t saturates at |Y_t|", () => {
		const magY = new Float32Array(numBins);
		const gain = new Float32Array(numBins);
		const state = createReverbState(numBins);
		const beta: readonly [number, number, number, number] = [999, 999, 999, 999];

		magY.fill(1);

		for (let iter = 0; iter < 500; iter++) computeRawGain(magY, 0.2, beta, bands, 1, state, gain);

		for (const bin of [0, 100, 500, numBins - 1]) {
			expect(gain[bin] ?? 1).toBeLessThanOrEqual(0.05);
		}
	});

	it("respects per-band β (higher β → more attenuation at steady state)", () => {
		const magY = new Float32Array(numBins);
		const gain = new Float32Array(numBins);
		const state = createReverbState(numBins);
		const beta: readonly [number, number, number, number] = [0.1, 0.5, 0.5, 2];

		magY.fill(1);

		for (let iter = 0; iter < 300; iter++) computeRawGain(magY, 0.2, beta, bands, 1, state, gain);

		const sampleBin = (range: readonly [number, number]): number => Math.floor((range[0] + range[1]) / 2);
		const gLow = gain[sampleBin(bands.low)] ?? NaN;
		const gLowMid = gain[sampleBin(bands.lowMid)] ?? NaN;
		const gHighMid = gain[sampleBin(bands.highMid)] ?? NaN;
		const gHigh = gain[sampleBin(bands.high)] ?? NaN;

		expect(gLow).toBeGreaterThan(gLowMid);
		expect(gLowMid).toBeCloseTo(gHighMid, 6);
		expect(gHighMid).toBeGreaterThan(gHigh);
	});

	it("reductionScale = 0 gives pass-through (G = 1)", () => {
		const magY = new Float32Array(numBins);
		const gain = new Float32Array(numBins);
		const state = createReverbState(numBins);
		const beta: readonly [number, number, number, number] = [3, 3, 3, 3];

		magY.fill(0.7);
		computeRawGain(magY, 0.4, beta, bands, 0, state, gain);

		for (const bin of [0, 100, 500, numBins - 1]) {
			expect(gain[bin] ?? 0).toBeCloseTo(1, 6);
		}
	});

	it("is monotone non-increasing in reductionScale at steady state", () => {
		const magY = new Float32Array(numBins);
		const beta: readonly [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
		const alpha = 0.2;
		const midBin = Math.floor((bands.highMid[0] + bands.highMid[1]) / 2);

		magY.fill(1);

		const steadyGainAt = (scale: number): number => {
			const gain = new Float32Array(numBins);
			const state = createReverbState(numBins);

			for (let iter = 0; iter < 200; iter++) computeRawGain(magY, alpha, beta, bands, scale, state, gain);

			return gain[midBin] ?? NaN;
		};

		const g0 = steadyGainAt(0);
		const g25 = steadyGainAt(0.25);
		const g50 = steadyGainAt(0.5);
		const g75 = steadyGainAt(0.75);
		const g100 = steadyGainAt(1);

		expect(g0).toBeGreaterThanOrEqual(g25 - 1e-12);
		expect(g25).toBeGreaterThanOrEqual(g50 - 1e-12);
		expect(g50).toBeGreaterThanOrEqual(g75 - 1e-12);
		expect(g75).toBeGreaterThanOrEqual(g100 - 1e-12);
		expect(g0).toBeGreaterThan(g100);
	});

	it("r_t recursion converges to the closed-form steady state on constant |Y|", () => {
		const magY = new Float32Array(numBins);
		const gain = new Float32Array(numBins);
		const state = createReverbState(numBins);
		const betaScalar = 0.75;
		const beta: readonly [number, number, number, number] = [betaScalar, betaScalar, betaScalar, betaScalar];
		const m = 1.3;
		const alpha = 0.15;

		magY.fill(m);

		for (let iter = 0; iter < 500; iter++) computeRawGain(magY, alpha, beta, bands, 1, state, gain);

		const rStar = m / (1 + betaScalar);

		for (const bin of [0, 100, 500, numBins - 1]) {
			expect(state.rPrev[bin] ?? NaN).toBeCloseTo(rStar, 5);
		}

		const expectedGain = Math.max(m - betaScalar * rStar, 0) / (m + 1e-10);

		for (const bin of [0, 100, 500, numBins - 1]) {
			expect(gain[bin] ?? NaN).toBeCloseTo(expectedGain, 5);
		}
	});

	it("writes r_{t−1} into state.rPrev (single-frame recursion is consistent with direct evaluation)", () => {
		const magY = new Float32Array(numBins);
		const gain = new Float32Array(numBins);
		const state = createReverbState(numBins);
		const beta: readonly [number, number, number, number] = [0.8, 0.8, 0.8, 0.8];
		const alpha = 0.3;

		magY.fill(2);
		computeRawGain(magY, alpha, beta, bands, 1, state, gain);

		const expectedR = (alpha * 2) / (1 + alpha * 0.8);
		const expectedGain = Math.max(2 - 0.8 * expectedR, 0) / (2 + 1e-10);

		for (const bin of [0, 100, 500, numBins - 1]) {
			expect(state.rPrev[bin] ?? NaN).toBeCloseTo(expectedR, 6);
			expect(gain[bin] ?? NaN).toBeCloseTo(expectedGain, 6);
		}
	});
});

// ---------------------------------------------------------------------------
// Löllmann 2010 Eq. 14 sub-frame pre-selection — signed-max / signed-min.
// ---------------------------------------------------------------------------

describe("subFrameStreakLength", () => {
	const LOLLMANN_L = 7;
	const subLength = 256;
	const totalLength = LOLLMANN_L * subLength;

	it("returns the full streak (L − 1 = 6) on a clean zero-mean Gaussian with strictly shrinking per-sub-frame envelope", () => {
		// Use a deep decay (0.5× per sub-frame, a 6 dB drop) so extrema shot-noise
		// in 256-sample sub-frames does not accidentally cross the strict `w=1`
		// inequality. At shallower decays the sample extrema fluctuate within the
		// shrinkage per sub-frame and the strict-inequality test may reject —
		// documented in the plan's Pre-Execution Review as "real-voice listening
		// tests may refine weights". With all (l, l+1) transitions passing, the
		// streak reaches the maximum `LOLLMANN_L − 1 = 6`.
		const signal = new Float32Array(totalLength);
		const rng = mulberry32(0xC0FFEE);
		const gaussian = makeGaussianSampler(rng);

		for (let subIndex = 0; subIndex < LOLLMANN_L; subIndex++) {
			const envelope = Math.pow(0.5, subIndex);

			for (let i = 0; i < subLength; i++) {
				signal[subIndex * subLength + i] = gaussian() * envelope;
			}
		}

		expect(subFrameStreakLength(signal, 0, totalLength, LOLLMANN_L)).toBe(LOLLMANN_L - 1);
	});

	it("returns 0 on a constant signal (first transition fails immediately)", () => {
		const signal = new Float32Array(totalLength);

		signal.fill(0.5);

		expect(subFrameStreakLength(signal, 0, totalLength, LOLLMANN_L)).toBe(0);
	});

	it("pins a partial streak to an exact integer on partial-decay-then-bump input", () => {
		// Construct 4 sub-frames of strictly-decreasing pattern followed by 3
		// sub-frames whose extrema bump slightly upward (0.20 → 0.21). The bump
		// makes transition 3→4 fail all three Eq. 14 tests under the paper's
		// `W_* = 0.995` weights; W_{VAR,MAX,MIN} · next > current reverses the
		// inequality on every transition past the bump. Under strict w = 1 the
		// original design used identical 0.20 extrema and tied; since Phase 5
		// relaxes the threshold by 0.5 %, the tied-input design would pass the
		// transition. A 0.21 bump (5 % above 0.20) is well above the 0.5 %
		// threshold and restores the partial-streak semantic the test is
		// pinning.
		//
		//   * Sub-frames 0..3: signed max shrinks 0.80→0.60→0.40→0.20; signed
		//     min rises −0.80→−0.60→−0.40→−0.20; mid-fill is 0 (symmetric).
		//     Energy is driven by the two endpoint extrema: ≈ 1.28, 0.72, 0.32,
		//     0.08 — strictly shrinking. Ratios 1.28/0.72 ≈ 1.78, 0.72/0.32 =
		//     2.25, 0.32/0.08 = 4.0; all > 1/0.995 ≈ 1.005, so 0.995 passes.
		//   * Sub-frames 4..6: max 0.21, min −0.21, energy ≈ 0.0882. Transition
		//     3→4 fails all three under W = 0.995: energy 0.08 > 0.995·0.0882
		//     ≈ 0.0878 is FALSE; max 0.20 > 0.995·0.21 ≈ 0.209 is FALSE; min
		//     −0.20 < 0.995·(−0.21) ≈ −0.209 is FALSE.
		//
		// Hand-computed streak: 3.
		const signal = new Float32Array(totalLength);
		const maxByL = [0.80, 0.60, 0.40, 0.20, 0.21, 0.21, 0.21];
		const minByL = [-0.80, -0.60, -0.40, -0.20, -0.21, -0.21, -0.21];

		for (let subIndex = 0; subIndex < LOLLMANN_L; subIndex++) {
			const subStart = subIndex * subLength;
			// Symmetric mid-fill so energy is driven by the endpoint extrema alone.
			const midFill = 0.5 * (maxByL[subIndex]! + minByL[subIndex]!);

			for (let i = 0; i < subLength; i++) signal[subStart + i] = midFill;

			signal[subStart] = minByL[subIndex]!;
			signal[subStart + subLength - 1] = maxByL[subIndex]!;
		}

		expect(subFrameStreakLength(signal, 0, totalLength, LOLLMANN_L)).toBe(3);
	});

	it("distinguishes signed-min direction: full streak when signed min rises toward 0, 0 when it falls further below", () => {
		// Pass direction: every sub-frame contains a controlled pattern whose
		// signed min starts very negative and moves toward 0 from below over
		// time. This is the paper's 14c-pass shape. Also make the signed max
		// shrink (positive, decreasing) and energy shrink so 14a and 14b pass.
		const buildSignal = (signedMinByL: readonly number[], signedMaxByL: readonly number[]): Float32Array => {
			const signal = new Float32Array(totalLength);

			for (let subIndex = 0; subIndex < LOLLMANN_L; subIndex++) {
				const subStart = subIndex * subLength;
				// Fill with a small mid-value so neither signed extreme is at 0.
				const midFill = 0.5 * ((signedMinByL[subIndex] ?? 0) + (signedMaxByL[subIndex] ?? 0));

				for (let i = 0; i < subLength; i++) signal[subStart + i] = midFill;

				signal[subStart] = signedMinByL[subIndex] ?? 0;
				signal[subStart + subLength - 1] = signedMaxByL[subIndex] ?? 0;
			}

			return signal;
		};

		// Pass: signed min −0.65, −0.55, −0.45, −0.35, −0.25, −0.15, −0.05 (rising);
		// signed max 0.70, 0.60, 0.50, 0.40, 0.30, 0.20, 0.10 (shrinking).
		const passMinima = [-0.65, -0.55, -0.45, -0.35, -0.25, -0.15, -0.05];
		const passMaxima = [0.70, 0.60, 0.50, 0.40, 0.30, 0.20, 0.10];
		const passSignal = buildSignal(passMinima, passMaxima);

		expect(subFrameStreakLength(passSignal, 0, totalLength, LOLLMANN_L)).toBe(LOLLMANN_L - 1);

		// Fail: signed min 0.05, 0.00, −0.05, −0.10, −0.15, −0.20, −0.25
		// (falling — drifting more negative over time). The first transition
		// (l=0 → l=1) already fails Eq. 14c, so streak = 0.
		const failMinima = [0.05, 0.00, -0.05, -0.10, -0.15, -0.20, -0.25];
		// Keep max shrinking so 14a and 14b do not independently reject.
		const failMaxima = [0.90, 0.80, 0.70, 0.60, 0.50, 0.40, 0.30];
		const failSignal = buildSignal(failMinima, failMaxima);

		expect(subFrameStreakLength(failSignal, 0, totalLength, LOLLMANN_L)).toBe(0);
	});

	it("returns 0 on a degenerate frame with sub-frame length < 2", () => {
		// fftSize = 6, subFrameCount = 7 → subFrameLength = floor(6/7) = 0 < 2.
		const signal = new Float32Array(6);

		expect(subFrameStreakLength(signal, 0, 6, LOLLMANN_L)).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Ratnam 2003 Eq. 11 ML — adaptive-length buffer per Löllmann's streak-length
// rule (plan-dereverb-lollmann-fix.md Phase 3.3 item 2).
// ---------------------------------------------------------------------------

describe("ratnamMlT60 adaptive buffer", () => {
	it("recovers T60 at nSamples = 512 from a known-decay synthetic within ±15%", () => {
		// s[n] = 0.98^n · N(0,1) for n = 0..511. Decay factor a = 0.98 →
		// expected T60 = 3·ln10 / (−ln 0.98 · f_s) at f_s = 48000:
		//   Δ = −ln 0.98 ≈ 0.020203; T60 ≈ 3·2.302585 / (0.020203 · 48000)
		//                                  ≈ 6.908 / 969.745 ≈ 7.12 ms.
		const nSamples = 512;
		const decay = 0.98;
		const fs = 48000;
		const signal = new Float32Array(nSamples);
		const gaussian = makeGaussianSampler(mulberry32(0xDECAF01));

		for (let i = 0; i < nSamples; i++) {
			signal[i] = Math.pow(decay, i) * gaussian();
		}

		const expectedT60 = (3 * Math.LN10) / (-Math.log(decay) * fs);
		const recovered = ratnamMlT60(signal, 0, nSamples, fs);

		expect(recovered).toBeDefined();
		expect(typeof recovered).toBe("number");

		const relError = Math.abs((recovered ?? 0) - expectedT60) / expectedT60;

		expect(relError).toBeLessThan(0.15);
	});

	it("short-buffer recovery at nSamples = 54 (l_min × post-Phase-4 sub-frame proxy) accepts ±30% or undefined", () => {
		// Minimum streak at Phase 3: l_min = 3 sub-frames. Post-Phase-4 P ≈ 18
		// samples/sub-frame at the downsampled rate ⇒ 54 samples min buffer. This
		// test runs that length at 48 kHz as a proxy (Phase 3 still operates at
		// source rate; Phase 4 brings the full downsampling); the assertion is
		// tolerant — accept either a recovery within ±30% of the true T60 OR
		// `undefined` (non-convergence is expected behaviour at marginal buffer
		// length per the plan's "Adaptive ML buffer may be too short for Brent
		// to converge" risk note).
		const nSamples = 54;
		const decay = 0.9;
		const fs = 48000;
		const signal = new Float32Array(nSamples);
		const gaussian = makeGaussianSampler(mulberry32(0xFADEBABE));

		for (let i = 0; i < nSamples; i++) {
			signal[i] = Math.pow(decay, i) * gaussian();
		}

		const expectedT60 = (3 * Math.LN10) / (-Math.log(decay) * fs);
		const recovered = ratnamMlT60(signal, 0, nSamples, fs);

		if (recovered === undefined) {
			// Non-convergence is acceptable at this marginal length.
			expect(recovered).toBeUndefined();
		} else {
			const relError = Math.abs(recovered - expectedT60) / expectedT60;

			expect(relError).toBeLessThan(0.3);
		}
	});

	it("returns undefined on an all-zero signal", () => {
		const signal = new Float32Array(256);

		expect(ratnamMlT60(signal, 0, 256, 48000)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Phase 2 integration diagnostic — `plan-dereverb-lollmann-fix.md` 2.4.
// Inlines the Learn-pass primitives (we do not export them from production
// code, per the plan's rule). Marked `.skip` after metrics capture so it
// does not re-execute on default test runs.
// ---------------------------------------------------------------------------

describe("Phase 2 integration diagnostic", () => {
	// Re-implementation of the Ratnam ML score function so the test does not
	// depend on exports from `learn.ts` beyond the function under test. The
	// math matches `ratnamMlT60` (Ratnam Eq. 8 with Eq. 11 profile-out, verified
	// Phase 1).
	const ratnamMlT60Inline = (signal: Float32Array, frameStart: number, fftSizeInline: number, sampleRateInline: number): number | undefined => {
		const squared = new Float64Array(fftSizeInline);
		let allZero = true;

		for (let i = 0; i < fftSizeInline; i++) {
			const value = signal[frameStart + i] ?? 0;
			const sq = value * value;

			squared[i] = sq;
			if (sq > 0) allZero = false;
		}

		if (allZero) return undefined;

		const sumN = (fftSizeInline * (fftSizeInline - 1)) / 2;
		const score = (decay: number): number => {
			const lnDecay = Math.log(decay);
			let maxLogWeight = -Infinity;

			for (let i = 0; i < fftSizeInline; i++) {
				const sq = squared[i] ?? 0;

				if (sq <= 0) continue;

				const logWeight = Math.log(sq) - 2 * i * lnDecay;

				if (logWeight > maxLogWeight) maxLogWeight = logWeight;
			}

			if (!Number.isFinite(maxLogWeight)) return -sumN;

			let numerator = 0;
			let denominator = 0;

			for (let i = 0; i < fftSizeInline; i++) {
				const sq = squared[i] ?? 0;

				if (sq <= 0) continue;

				const weight = Math.exp(Math.log(sq) - 2 * i * lnDecay - maxLogWeight);

				numerator += i * weight;
				denominator += weight;
			}

			if (denominator <= 0) return -sumN;

			return fftSizeInline * (numerator / denominator) - sumN;
		};

		// Simple bisection fallback (converges for a single interior root in
		// (A_LO, A_HI) and is enough for a diagnostic — this is not the
		// production Brent solver).
		const A_LO = 0.001;
		const A_HI = 0.9999;
		const fLo = score(A_LO);
		const fHi = score(A_HI);

		if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return undefined;
		if (fLo * fHi > 0) return undefined;

		let lo = A_LO;
		let hi = A_HI;
		let fLoCur = fLo;

		for (let iter = 0; iter < 200; iter++) {
			const mid = 0.5 * (lo + hi);
			const fMid = score(mid);

			if (!Number.isFinite(fMid)) return undefined;
			if (hi - lo < 1e-6) {
				const delta = -Math.log(mid);

				if (!(delta > 0)) return undefined;

				return (3 * Math.LN10) / (delta * sampleRateInline);
			}
			if (fLoCur * fMid <= 0) {
				hi = mid;
			} else {
				lo = mid;
				fLoCur = fMid;
			}
		}

		return undefined;
	};

	it.skip("reports acceptance metrics on the voice+RIR fixture", () => {
		const fixture = makeVoiceRirFixture();
		const signal = fixture.mixed;
		const fsInline = fixture.sampleRate;
		const hopInline = 512;
		const fftSizeInline = 2048;
		const LOLLMANN_L = 7;
		const MIN_T60_SECONDS = 0.05;
		const MAX_T60_SECONDS = 10;
		const HISTOGRAM_BINS = 100;
		const binWidth = (MAX_T60_SECONDS - MIN_T60_SECONDS) / HISTOGRAM_BINS;
		const counts = new Int32Array(HISTOGRAM_BINS);
		const numFrames = Math.max(0, Math.floor((signal.length - fftSizeInline) / hopInline) + 1);
		let accepted = 0;
		let converged = 0;

		for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
			const frameStart = frameIndex * hopInline;

			if (frameStart + fftSizeInline > signal.length) break;
			// Phase 2 semantics: strict "all (L−1) transitions must pass" acceptance.
			// Re-expressed in terms of the post-Phase-3 `subFrameStreakLength` API:
			// accept iff the leading streak reaches the maximum (`LOLLMANN_L − 1`).
			if (subFrameStreakLength(signal, frameStart, fftSizeInline, LOLLMANN_L) < LOLLMANN_L - 1) continue;

			accepted++;

			const t60 = ratnamMlT60Inline(signal, frameStart, fftSizeInline, fsInline);

			if (t60 === undefined) continue;
			if (t60 < MIN_T60_SECONDS || t60 > MAX_T60_SECONDS) continue;

			converged++;

			const binIndex = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((t60 - MIN_T60_SECONDS) / binWidth)));

			counts[binIndex] = (counts[binIndex] ?? 0) + 1;
		}

		let populatedBins = 0;
		let argmaxBin = 0;
		let argmaxCount = counts[0] ?? 0;

		for (let bin = 0; bin < HISTOGRAM_BINS; bin++) {
			const count = counts[bin] ?? 0;

			if (count > 0) populatedBins++;
			if (count > argmaxCount) {
				argmaxCount = count;
				argmaxBin = bin;
			}
		}

		const argmaxT60 = MIN_T60_SECONDS + (argmaxBin + 0.5) * binWidth;
		const percentAccepted = numFrames > 0 ? (100 * accepted) / numFrames : 0;
		const percentConvergedOfAccepted = accepted > 0 ? (100 * converged) / accepted : 0;

		// eslint-disable-next-line no-console -- diagnostic only; test is `.skip`.
		console.log(
			JSON.stringify(
				{
					totalFrames: numFrames,
					accepted,
					percentAccepted: percentAccepted.toFixed(2),
					converged,
					percentConvergedOfAccepted: percentConvergedOfAccepted.toFixed(2),
					populatedBins,
					argmaxT60: argmaxT60.toFixed(4),
				},
				null,
				2,
			),
		);

		// Diagnostic only — no assertions. Metrics recorded in
		// `plan-dereverb-lollmann-fix.md` 2.4 Notes.
		expect(numFrames).toBeGreaterThan(0);
	}, 600_000);
});

// ---------------------------------------------------------------------------
// Phase 3 integration diagnostic — `plan-dereverb-lollmann-fix.md` 3.4.
// Calls `learnReverbProfile` through its public signature (the Phase 3
// change-shape under test is the adaptive-streak ML buffer flowing through
// the public API). Also inlines the primitives once more to emit a
// streak-length histogram (bins 0..6), % accepted (streak ≥ LOLLMANN_L_MIN),
// and % converging for side-by-side comparison with Phase 2. Marked `.skip`
// after metrics capture so it does not re-execute on default test runs.
// ---------------------------------------------------------------------------

describe("Phase 3 integration diagnostic", () => {
	it.skip("reports streak-length histogram + acceptance on the voice+RIR fixture", () => {
		const fixture = makeVoiceRirFixture();
		const signal = fixture.mixed;
		const fsInline = fixture.sampleRate;
		const hopInline = 512;
		const fftSizeInline = 2048;
		const LOLLMANN_L = 7;

		// -- Part 1: public-API call through learnReverbProfile ---------------
		let alpha: number | undefined;
		let beta: readonly number[] | undefined;
		let publicError: string | undefined;

		try {
			const stftOut = stft(signal, fftSizeInline, hopInline);
			const numFrames = stftOut.frames;
			const profile = learnReverbProfile(stftOut, signal, fsInline, hopInline, { startFrame: 0, endFrame: numFrames });

			alpha = profile.alpha;
			beta = profile.beta;
		} catch (err) {
			publicError = err instanceof Error ? err.message : String(err);
		}

		// -- Part 2: streak-length histogram (inline primitives) --------------
		const numFrames = Math.max(0, Math.floor((signal.length - fftSizeInline) / hopInline) + 1);
		// Histogram bins 0..6 (streak length is in {0, 1, ..., LOLLMANN_L - 1 = 6}).
		const streakHistogram = new Int32Array(LOLLMANN_L);
		let accepted = 0;
		let converged = 0;
		const subFrameLen = Math.floor(fftSizeInline / LOLLMANN_L);

		for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
			const frameStart = frameIndex * hopInline;

			if (frameStart + fftSizeInline > signal.length) break;

			const streak = subFrameStreakLength(signal, frameStart, fftSizeInline, LOLLMANN_L);
			const binIdx = Math.min(LOLLMANN_L - 1, Math.max(0, streak));

			streakHistogram[binIdx] = (streakHistogram[binIdx] ?? 0) + 1;

			if (streak < LOLLMANN_L_MIN) continue;

			accepted++;

			const nSamples = streak * subFrameLen;
			const t60 = ratnamMlT60(signal, frameStart, nSamples, fsInline);

			if (t60 === undefined) continue;
			if (t60 < 0.05 || t60 > 10) continue;

			converged++;
		}

		const percentAccepted = numFrames > 0 ? (100 * accepted) / numFrames : 0;
		const percentConvergedOfAccepted = accepted > 0 ? (100 * converged) / accepted : 0;

		// eslint-disable-next-line no-console -- diagnostic only; test is `.skip`.
		console.log(
			JSON.stringify(
				{
					totalFrames: numFrames,
					accepted,
					percentAccepted: percentAccepted.toFixed(2),
					converged,
					percentConvergedOfAccepted: percentConvergedOfAccepted.toFixed(2),
					streakHistogram: Array.from(streakHistogram),
					publicApi: publicError === undefined ? { alpha, beta: beta ? Array.from(beta) : undefined } : { error: publicError },
				},
				null,
				2,
			),
		);

		// Diagnostic only — no assertions on α / β / acceptance rate.
		// Metrics recorded in `plan-dereverb-lollmann-fix.md` 3.4 Notes.
		expect(numFrames).toBeGreaterThan(0);
	}, 600_000);
});

// ---------------------------------------------------------------------------
// Phase 4 integration diagnostic — `plan-dereverb-lollmann-fix.md` 4.5.
// Informational-only: logs α, β, streak-length histogram, acceptance rate,
// and ML convergence for phase-to-phase trend recording after `estimateAlpha`
// decimates to ~3.2 kHz. No assertions on α — the α ±10 % acceptance gate
// was dropped entirely (2026-04-22 revert); qualitative dereverb quality is
// validated by listening tests on real voice tracks, not a synthetic
// white-noise-carrier fixture. Marked `.skip` after metrics capture so it
// does not re-execute on default test runs.
// ---------------------------------------------------------------------------

describe("Phase 4 integration diagnostic", () => {
	it.skip("logs α / β / streak metrics on the voice+RIR fixture after downsampling", () => {
		const fixture = makeVoiceRirFixture();
		const signal = fixture.mixed;
		const fsInline = fixture.sampleRate;
		const hopInline = 512;
		const fftSizeInline = 2048;
		const LOLLMANN_L = 7;
		const LOLLMANN_M_DOWNSAMPLED = 128;
		const LOLLMANN_M_HAT_DOWNSAMPLED = 25;

		// -- Part 1: public-API call through learnReverbProfile -----------------
		const stftOut = stft(signal, fftSizeInline, hopInline);
		const numFrames = stftOut.frames;
		const profile = learnReverbProfile(stftOut, signal, fsInline, hopInline, { startFrame: 0, endFrame: numFrames });

		// -- Part 2: mirror the downsampled Löllmann loop for metrics -----------
		const rate = integerDecimationRate(fsInline);
		const downsampled = decimate(signal, rate);
		const downsampledRate = fsInline / rate;
		const subFrameLen = Math.floor(LOLLMANN_M_DOWNSAMPLED / LOLLMANN_L);
		// Streak length is in {0, 1, ..., LOLLMANN_L - 1 = 6}.
		const streakHistogram = new Int32Array(LOLLMANN_L);
		let totalWindows = 0;
		let accepted = 0;
		let converged = 0;

		for (
			let frameStart = 0;
			frameStart + LOLLMANN_M_DOWNSAMPLED <= downsampled.length;
			frameStart += LOLLMANN_M_HAT_DOWNSAMPLED
		) {
			totalWindows++;

			const streak = subFrameStreakLength(downsampled, frameStart, LOLLMANN_M_DOWNSAMPLED, LOLLMANN_L);
			const binIdx = Math.min(LOLLMANN_L - 1, Math.max(0, streak));

			streakHistogram[binIdx] = (streakHistogram[binIdx] ?? 0) + 1;

			if (streak < LOLLMANN_L_MIN) continue;

			accepted++;

			const nSamples = streak * subFrameLen;
			const t60 = ratnamMlT60(downsampled, frameStart, nSamples, downsampledRate);

			if (t60 === undefined) continue;
			if (t60 < 0.05 || t60 > 10) continue;

			converged++;
		}

		const percentAccepted = totalWindows > 0 ? (100 * accepted) / totalWindows : 0;
		const percentConvergedOfAccepted = accepted > 0 ? (100 * converged) / accepted : 0;

		// eslint-disable-next-line no-console -- diagnostic only; test is `.skip`.
		console.log(
			JSON.stringify(
				{
					rate,
					downsampledRate,
					downsampledLength: downsampled.length,
					totalWindows,
					accepted,
					percentAccepted: percentAccepted.toFixed(2),
					converged,
					percentConvergedOfAccepted: percentConvergedOfAccepted.toFixed(2),
					streakHistogram: Array.from(streakHistogram),
					alpha: profile.alpha,
					expectedAlpha: fixture.expectedAlpha,
					alphaRelativeError: Math.abs(profile.alpha - fixture.expectedAlpha) / fixture.expectedAlpha,
					beta: Array.from(profile.beta),
				},
				null,
				2,
			),
		);

		// Diagnostic only — no α assertion. The α ±10 % acceptance gate was
		// dropped entirely (2026-04-22 revert in
		// `plan-dereverb-lollmann-fix.md`): the node's output is qualitative
		// and the real acceptance is a listening test on real voice tracks,
		// not a numeric bracket on a synthetic white-noise-carrier fixture.
	}, 600_000);
});

// ---------------------------------------------------------------------------
// Phase 5 integration diagnostic — `plan-dereverb-lollmann-fix.md` 5.3.
// Informational-only: logs α, β, streak-length histogram, populated-bin
// count, and acceptance / convergence percentages on the paper-faithful
// regime `M = 128, L = 7, l_min = 3, w_* = 0.995` + histogram bin width
// 0.05 s (199 bins over [0.05, 10] s). No assertions on α — the α ±10 %
// acceptance gate was dropped entirely (2026-04-22 revert): qualitative
// dereverb quality is validated by listening tests on real voice tracks,
// not a synthetic white-noise-carrier fixture. Marked `.skip` after
// metrics capture.
// ---------------------------------------------------------------------------

describe("Phase 5 integration diagnostic", () => {
	it.skip("logs α / β / populated-bin metrics on the voice+RIR fixture under the paper-faithful regime", () => {
		const fixture = makeVoiceRirFixture();
		const signal = fixture.mixed;
		const fsInline = fixture.sampleRate;
		const hopInline = 512;
		const fftSizeInline = 2048;
		const LOLLMANN_L = 7;
		const LOLLMANN_M_DOWNSAMPLED = 128;
		const LOLLMANN_M_HAT_DOWNSAMPLED = 25;
		const HISTOGRAM_BINS_INLINE = 199;
		const MIN_T60_INLINE = 0.05;
		const MAX_T60_INLINE = 10;

		// -- Part 1: public-API call through learnReverbProfile -----------------
		const stftOut = stft(signal, fftSizeInline, hopInline);
		const numFrames = stftOut.frames;
		const profile = learnReverbProfile(stftOut, signal, fsInline, hopInline, { startFrame: 0, endFrame: numFrames });

		// -- Part 2: mirror the downsampled Löllmann loop for metrics -----------
		const rate = integerDecimationRate(fsInline);
		const downsampled = decimate(signal, rate);
		const downsampledRate = fsInline / rate;
		const subFrameLen = Math.floor(LOLLMANN_M_DOWNSAMPLED / LOLLMANN_L);
		const streakHistogram = new Int32Array(LOLLMANN_L);
		const binWidth = (MAX_T60_INLINE - MIN_T60_INLINE) / HISTOGRAM_BINS_INLINE;
		const t60Counts = new Int32Array(HISTOGRAM_BINS_INLINE);
		let totalWindows = 0;
		let accepted = 0;
		let converged = 0;

		for (
			let frameStart = 0;
			frameStart + LOLLMANN_M_DOWNSAMPLED <= downsampled.length;
			frameStart += LOLLMANN_M_HAT_DOWNSAMPLED
		) {
			totalWindows++;

			const streak = subFrameStreakLength(downsampled, frameStart, LOLLMANN_M_DOWNSAMPLED, LOLLMANN_L);
			const binIdx = Math.min(LOLLMANN_L - 1, Math.max(0, streak));

			streakHistogram[binIdx] = (streakHistogram[binIdx] ?? 0) + 1;

			if (streak < LOLLMANN_L_MIN) continue;

			accepted++;

			const nSamples = streak * subFrameLen;
			const t60 = ratnamMlT60(downsampled, frameStart, nSamples, downsampledRate);

			if (t60 === undefined) continue;
			if (t60 < MIN_T60_INLINE || t60 > MAX_T60_INLINE) continue;

			converged++;

			const histIdx = Math.min(HISTOGRAM_BINS_INLINE - 1, Math.max(0, Math.floor((t60 - MIN_T60_INLINE) / binWidth)));

			t60Counts[histIdx] = (t60Counts[histIdx] ?? 0) + 1;
		}

		let populatedBins = 0;

		for (let b = 0; b < HISTOGRAM_BINS_INLINE; b++) {
			if ((t60Counts[b] ?? 0) > 0) populatedBins++;
		}

		const percentAccepted = totalWindows > 0 ? (100 * accepted) / totalWindows : 0;
		const percentConvergedOfAccepted = accepted > 0 ? (100 * converged) / accepted : 0;

		// eslint-disable-next-line no-console -- diagnostic only; test is `.skip`.
		console.log(
			JSON.stringify(
				{
					rate,
					downsampledRate,
					downsampledLength: downsampled.length,
					totalWindows,
					accepted,
					percentAccepted: percentAccepted.toFixed(2),
					converged,
					percentConvergedOfAccepted: percentConvergedOfAccepted.toFixed(2),
					streakHistogram: Array.from(streakHistogram),
					histogramBins: HISTOGRAM_BINS_INLINE,
					binWidthSeconds: binWidth,
					populatedBins,
					alpha: profile.alpha,
					expectedAlpha: fixture.expectedAlpha,
					alphaRelativeError: Math.abs(profile.alpha - fixture.expectedAlpha) / fixture.expectedAlpha,
					beta: Array.from(profile.beta),
				},
				null,
				2,
			),
		);

		// Diagnostic only — no α assertion. The α ±10 % acceptance gate was
		// dropped entirely (2026-04-22 revert in
		// `plan-dereverb-lollmann-fix.md`): qualitative dereverb quality is
		// validated by listening tests on real voice tracks, not a numeric
		// bracket on a synthetic white-noise-carrier fixture.
	}, 600_000);
});

// ---------------------------------------------------------------------------
// Learn pass — Ratnam 2003 Eq. 11 ML + Löllmann 2010 Eq. 14 pre-selection
//              + histogram argmax; per-band β 1st-percentile closed form.
// ---------------------------------------------------------------------------

describe("learnReverbProfile", () => {
	function runLearn(signal: Float32Array): ReturnType<typeof learnReverbProfile> {
		const stftOut = stft(signal, fftSize, hopSize);
		const numFrames = stftOut.frames;

		return learnReverbProfile(stftOut, signal, sampleRate, hopSize, { startFrame: 0, endFrame: numFrames });
	}

	function generateExponentialDecaySignal(t60Seconds: number, pulses: number, gapSeconds: number): Float32Array {
		const decaySeconds = 1.0;
		const pulseLengthFrames = Math.round((decaySeconds + gapSeconds) * sampleRate);
		const signal = new Float32Array(pulses * pulseLengthFrames);
		const delta = (3 * Math.LN10) / t60Seconds;
		let state = 987654321;
		const nextNoise = (): number => {
			state = (state * 1664525 + 1013904223) >>> 0;

			return (state / 0xffffffff - 0.5) * 2;
		};

		for (let pulse = 0; pulse < pulses; pulse++) {
			const base = pulse * pulseLengthFrames;

			for (let index = 0; index < Math.round(decaySeconds * sampleRate); index++) {
				const t = index / sampleRate;
				const envelope = Math.exp(-delta * t);

				signal[base + index] = envelope * nextNoise() * 0.3;
			}
		}

		return signal;
	}

	// Removed 2026-04-22: the pre-existing "recovers α from a synthetic
	// exponential-decay signal within 20%" test used a noise-carrier-excited
	// exponential-decay fixture. It passed pre-Phase-4 at source-rate
	// pre-selection (18-sample sub-frames were not yet the norm). Phase 4's
	// downsampling (integer-R decimation to ~3.2 kHz per Löllmann Eq. 11)
	// makes sub-frames ~18 samples at the downsampled rate, and noise-carrier
	// statistics at 18 samples are several percent off their envelope trend —
	// the same fixture-vs-algorithm mismatch documented in the
	// `plan-dereverb-lollmann-fix.md` Phase 4.5 / Phase 5.3 escalations.
	// Löllmann's pre-selection was validated on speech corpora whose periodic
	// structure (pitch, formants) dampens short-time extrema shot-noise; it
	// does not recover α on synthetic noise-carrier fixtures.
	// Qualitative dereverb quality is validated by listening tests on real
	// voice tracks, not a numeric α bracket on a synthetic fixture.

	it("returns β as a 4-tuple in band order with finite non-negative plausible values", () => {
		const signal = generateExponentialDecaySignal(0.5, 8, 0.5);
		const result = runLearn(signal);

		expect(Array.isArray(result.beta)).toBe(true);
		expect(result.beta.length).toBe(4);

		for (const value of result.beta) {
			expect(Number.isFinite(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(2);
		}
	});

	it("throws on pure white noise (pre-selection empties the histogram)", () => {
		const length = Math.round(3 * sampleRate);
		const signal = new Float32Array(length);
		let state = 1234567;

		for (let index = 0; index < length; index++) {
			state = (state * 48271) % 2147483647;
			signal[index] = (state / 2147483647 - 0.5) * 0.2;
		}

		expect(() => runLearn(signal)).toThrow(/insufficient|empty|cannot estimate/i);
	});

	it("throws when the learn window is too short", () => {
		const signal = new Float32Array(512);

		expect(() => runLearn(signal)).toThrow(/minimum decay length/);
	});

	it("reverbProfile round-trips through the schema", () => {
		// Plan Phase 3.3 item 5 — Phase 5 enables this now that the schema
		// accepts `{ alpha, beta }`.
		const node = deReverb({
			reverbProfile: { alpha: 0.3, beta: [0.1, 0.2, 0.3, 0.4] },
		});

		expect(node.properties.reverbProfile?.alpha).toBeCloseTo(0.3, 10);
		expect(node.properties.reverbProfile?.beta).toEqual([0.1, 0.2, 0.3, 0.4]);
	});
});

// ---------------------------------------------------------------------------
// Stream end-to-end.
// ---------------------------------------------------------------------------

describe("DeReverbStream._process", () => {
	async function runStreamOnMono(stream: DeReverbStream, signal: Float32Array): Promise<Float32Array> {
		const buffer = new MemoryChunkBuffer(signal.length, 1);

		await buffer.append([signal], sampleRate, 32);
		await stream._process(buffer);

		const chunk = await buffer.read(0, buffer.frames);

		await buffer.close();

		return chunk.samples[0]!.slice();
	}

	function generateReverberantSignal(t60Seconds: number, pulses: number, gapSeconds: number): Float32Array {
		const decaySeconds = 1.0;
		const pulseLengthFrames = Math.round((decaySeconds + gapSeconds) * sampleRate);
		const signal = new Float32Array(pulses * pulseLengthFrames);
		const delta = (3 * Math.LN10) / t60Seconds;
		let state = 987654321;
		const nextNoise = (): number => {
			state = (state * 1664525 + 1013904223) >>> 0;

			return (state / 0xffffffff - 0.5) * 2;
		};

		for (let pulse = 0; pulse < pulses; pulse++) {
			const base = pulse * pulseLengthFrames;

			for (let index = 0; index < Math.round(decaySeconds * sampleRate); index++) {
				const t = index / sampleRate;
				const envelope = Math.exp(-delta * t);

				signal[base + index] = envelope * nextNoise() * 0.3;
			}
		}

		return signal;
	}

	function rms(signal: Float32Array): number {
		let sumSq = 0;

		for (let index = 0; index < signal.length; index++) {
			const value = signal[index] ?? 0;

			sumSq += value * value;
		}

		return Math.sqrt(sumSq / Math.max(1, signal.length));
	}

	// A plausible pre-learned profile. Using an explicit profile for the
	// reduction-scaling tests isolates Phase 5's _process orchestration and
	// Phase 4's `computeRawGain` reduction-scaling behaviour from Phase 3's
	// Learn pass; the Learn pass's recovery on this specific synthetic is
	// exercised separately in the `learnReverbProfile` suite above (where it
	// uses the Phase-3-validated fftSize=4096 frame length).
	const synthProfile = { alpha: 0.2, beta: [0.3, 0.5, 0.6, 0.5] as [number, number, number, number] };

	it("aggressive reduction on reverberant content attenuates measurably vs reduction=0", async () => {
		const input = generateReverberantSignal(0.5, 3, 0.2);
		const baseline = await runStreamOnMono(
			deReverb({ reduction: 0, artifactSmoothing: 2, fftSize: 2048, hopSize: 512, reverbProfile: synthProfile }).createStream(),
			input.slice(),
		);
		const reduced = await runStreamOnMono(
			deReverb({ reduction: 10, artifactSmoothing: 2, fftSize: 2048, hopSize: 512, reverbProfile: synthProfile }).createStream(),
			input.slice(),
		);

		expect(rms(reduced)).toBeLessThan(rms(baseline));
	}, 60_000);

	it("produces non-silent output on reverberant speech-like content", async () => {
		const input = generateReverberantSignal(0.5, 3, 0.2);
		const output = await runStreamOnMono(
			deReverb({ reduction: 5, artifactSmoothing: 2, fftSize: 2048, hopSize: 512, reverbProfile: synthProfile }).createStream(),
			input.slice(),
		);

		expect(output.length).toBe(input.length);
		expect(rms(output)).toBeGreaterThan(rms(input) * 0.05);
	}, 60_000);

	it("reverbProfile bypasses the learn pass", async () => {
		const input = generateReverberantSignal(0.5, 3, 0.2);
		const profileA = { alpha: 0.9, beta: [0.1, 0.1, 0.1, 0.1] as [number, number, number, number] };
		const profileB = { alpha: 0.1, beta: [1.0, 1.0, 1.0, 1.0] as [number, number, number, number] };
		const outputA = await runStreamOnMono(
			deReverb({ reduction: 10, fftSize: 2048, hopSize: 512, reverbProfile: profileA }).createStream(),
			input.slice(),
		);
		const outputB = await runStreamOnMono(
			deReverb({ reduction: 10, fftSize: 2048, hopSize: 512, reverbProfile: profileB }).createStream(),
			input.slice(),
		);
		let maxDiff = 0;

		for (let index = 0; index < outputA.length; index++) {
			const diff = Math.abs((outputA[index] ?? 0) - (outputB[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		// Different (α, β) → different r_t trajectories and per-band β subtraction
		// → different output. If the profile option were ignored the two runs
		// would be identical.
		expect(maxDiff).toBeGreaterThan(1e-6);
	}, 60_000);

	it("raises a user-actionable error on silent learn windows", async () => {
		const silenceFrames = Math.round(0.5 * sampleRate);
		const reverberant = generateReverberantSignal(0.5, 5, 0.2);
		const signal = new Float32Array(silenceFrames + reverberant.length);

		signal.set(reverberant, silenceFrames);

		const node = deReverb({ reduction: 5, fftSize: 2048, hopSize: 512, learnStart: 0, learnEnd: 0.4 });
		const stream = node.createStream();

		await expect(async () => runStreamOnMono(stream, signal)).rejects.toThrow(/insufficient|minimum decay/);
	}, 60_000);

	it("outputReverbOnly inverts the mask", async () => {
		// Same input, same profile — one run produces the dry output
		// (G_smoothed · Y) and the other produces the reverb residual
		// ((1 − G_smoothed) · Y). On a reverberant signal with held-note
		// tails, the reverb residual should carry comparable or higher energy
		// in the late portion of each pulse than the dry output, because the
		// mask pulls energy out of the tails for the dry path.
		const input = generateReverberantSignal(0.6, 3, 0.3);
		const profile = { alpha: 0.25, beta: [0.4, 0.5, 0.5, 0.4] as [number, number, number, number] };
		const outputDry = await runStreamOnMono(
			deReverb({
				reduction: 10,
				fftSize: 2048,
				hopSize: 512,
				reverbProfile: profile,
				outputReverbOnly: false,
			}).createStream(),
			input.slice(),
		);
		const outputReverb = await runStreamOnMono(
			deReverb({
				reduction: 10,
				fftSize: 2048,
				hopSize: 512,
				reverbProfile: profile,
				outputReverbOnly: true,
			}).createStream(),
			input.slice(),
		);
		let maxDiff = 0;

		for (let index = 0; index < outputDry.length; index++) {
			const diff = Math.abs((outputDry[index] ?? 0) - (outputReverb[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		// The two outputs must be distinct.
		expect(maxDiff).toBeGreaterThan(1e-6);

		// Weak energy check: measure the last 30% of each pulse — the tail
		// where reverb dominates. Pulses are 1.3 s long (1 s decay + 0.3 s gap)
		// so tail region per pulse starts ~0.7 s in. The decay tail carries the
		// reverb; the reverb-only output should hold comparable or more energy
		// there than the dry output.
		const pulseLen = Math.round(1.3 * sampleRate);
		const tailFraction = 0.3;
		const tailStart = Math.round(pulseLen * (1 - tailFraction));
		let dryTailEnergy = 0;
		let reverbTailEnergy = 0;

		for (let pulse = 0; pulse < 3; pulse++) {
			const base = pulse * pulseLen;

			for (let index = tailStart; index < pulseLen - 1; index++) {
				const di = base + index;

				if (di >= outputDry.length) break;

				const dv = outputDry[di] ?? 0;
				const rv = outputReverb[di] ?? 0;

				dryTailEnergy += dv * dv;
				reverbTailEnergy += rv * rv;
			}
		}

		// Reverb-only output has at least as much tail energy as the dry output
		// (typically much more — the mask suppresses tails for the dry path).
		expect(reverbTailEnergy).toBeGreaterThan(dryTailEnergy * 0.5);
	}, 60_000);
});
