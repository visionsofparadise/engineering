import { describe, it, expect } from "vitest";
import { MemoryChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { deClick, DeClickStream } from ".";
import { mouthDeClick } from "./mouth-de-click";
import { deCrackle } from "./de-crackle";
import { burgMethod } from "./utils/ar-model";
import { groupContiguousGaps, lsarInterpolate } from "./utils/lsar";

// ---------------------------------------------------------------------------
// LSAR interpolation (G&R §6.2). `lsar.ts` is retained post-Phase-5 and is
// called per-block by the BMRI pipeline, so its direct correctness still
// matters at the unit-test level.
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
// Schema defaults — `deClick()` and the two presets must match the defaults
// stated in `design-declick.md` §"Parameter schemas" / §"mouthDeClick preset"
// / §"deCrackle preset". Regression check for any drift between the schema
// and the design doc.
// ---------------------------------------------------------------------------

describe("deClick schema defaults", () => {
	it("deClick() defaults match the design-declick base schema", () => {
		const node = deClick();

		expect(node.properties.sensitivity).toBe(0.5);
		expect(node.properties.frequencySkew).toBe(0);
		expect(node.properties.clickWidening).toBe(0.25);
		expect(node.properties.maxClickDuration).toBe(200);
		// Base preset is unrestricted: minFrequency defaults to 0 (DC), and
		// maxFrequency is undefined (no upper cap). See design-declick
		// 2026-04-24 band-restriction decision log entry.
		expect(node.properties.minFrequency).toBe(0);
		expect(node.properties.maxFrequency).toBeUndefined();
	});

	it("mouthDeClick() defaults are the mouth-tuned preset", () => {
		const node = mouthDeClick();

		expect(node.properties.sensitivity).toBe(0.5);
		expect(node.properties.frequencySkew).toBe(0.3);
		expect(node.properties.clickWidening).toBe(0.3);
		expect(node.properties.maxClickDuration).toBe(50);
		// Dolby EP4196978B1 attenuation band: above 4 kHz, no upper cap,
		// preserving speech harmonics below 4 kHz. See design-declick
		// 2026-04-24 band-restriction decision log entry.
		expect(node.properties.minFrequency).toBe(4000);
		expect(node.properties.maxFrequency).toBeUndefined();
	});

	it("deCrackle() defaults are the crackle-tuned preset", () => {
		const node = deCrackle();

		expect(node.properties.sensitivity).toBe(0.6);
		expect(node.properties.frequencySkew).toBe(0);
		expect(node.properties.clickWidening).toBe(0.1);
		expect(node.properties.maxClickDuration).toBe(20);
		// Crackle is broadband — no band restriction. Inherits base defaults.
		expect(node.properties.minFrequency).toBe(0);
		expect(node.properties.maxFrequency).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// End-to-end BMRI DeClickStream behaviour on synthetic fixtures. Directly
// invokes `stream._process` on a `MemoryChunkBuffer` — no file I/O, no
// `_setup`. `this.fftBackend` stays undefined (JS backend) and
// `this.sampleRate` falls through to the 44100 default in `_process`.
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44_100;

async function runStreamOnMono(stream: DeClickStream, signal: Float32Array): Promise<Float32Array> {
	const buffer = new MemoryChunkBuffer(signal.length, 1);

	await buffer.append([signal], SAMPLE_RATE, 32);
	await stream._process(buffer);

	const chunk = await buffer.read(0, buffer.frames);
	const out = chunk.samples[0]!.slice();

	await buffer.close();

	return out;
}

/** Box-Muller Gaussian from a seeded LCG, wrapped in Paul Kellet's economy pink filter. */
function makePinkNoise(length: number, seed: number): Float32Array {
	const signal = new Float32Array(length);
	let s = seed;
	const rand = (): number => {
		s = (s * 48271) % 2147483647;

		return (s / 2147483647) * 2 - 1;
	};
	let b0 = 0;
	let b1 = 0;
	let b2 = 0;

	for (let i = 0; i < length; i++) {
		const white = rand();

		b0 = 0.99765 * b0 + white * 0.099046;
		b1 = 0.963 * b1 + white * 0.2965164;
		b2 = 0.57 * b2 + white * 1.0526913;

		signal[i] = (b0 + b1 + b2 + white * 0.1848) * 0.05;
	}

	return signal;
}

function rms(signal: ArrayLike<number>, start = 0, end = signal.length): number {
	let sumSq = 0;
	let count = 0;

	for (let i = start; i < end; i++) {
		const value = signal[i] ?? 0;

		sumSq += value * value;
		count++;
	}

	return Math.sqrt(sumSq / Math.max(1, count));
}

describe("DeClickStream end-to-end", () => {
	it("bypasses bit-identically at sensitivity = 0", async () => {
		// Short synthetic sine; sensitivity = 0 maps to γ = 0 ⇒ early exit in
		// `_process` with no mutation. The output must equal the input
		// bit-for-bit (design-declick "Parameter mapping" + `_process` line 104).
		const n = 8192;
		const signal = new Float32Array(n);

		for (let i = 0; i < n; i++) signal[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);

		const stream = deClick({ sensitivity: 0 }).createStream();
		const output = await runStreamOnMono(stream, signal.slice());

		let maxDiff = 0;

		for (let i = 0; i < n; i++) {
			maxDiff = Math.max(maxDiff, Math.abs((output[i] ?? 0) - (signal[i] ?? 0)));
		}

		expect(maxDiff).toBeLessThan(1e-9);
	}, 30_000);

	it("mask-kept low-frequency content survives to iSTFT round-trip precision", async () => {
		// A 200 Hz sine at 0.5 amplitude sits in the lowest STFT bins. With the
		// adaptive threshold converging to the sine's periodogram, those bins
		// are routed to the mask-kept target path which passes through
		// `spectralCorrectAndRecombine` unchanged (up to Hann OLA rounding).
		// Use a long-enough buffer that the τ_att ≈ 10 s attack smoother
		// converges for at least a late-window slice.
		const durationSec = 12;
		const n = SAMPLE_RATE * durationSec;
		const signal = new Float32Array(n);

		for (let i = 0; i < n; i++) signal[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE);

		const stream = deClick({ sensitivity: 0.5 }).createStream();
		const output = await runStreamOnMono(stream, signal.slice());

		// Ignore the first second (warm-up) and the last fftSize samples
		// (zero-pad alignment) when measuring max-abs deviation.
		const start = SAMPLE_RATE;
		const end = n - 4096;
		let maxDiff = 0;

		for (let i = start; i < end; i++) {
			maxDiff = Math.max(maxDiff, Math.abs((output[i] ?? 0) - (signal[i] ?? 0)));
		}

		expect(maxDiff).toBeLessThan(1e-3);
	}, 120_000);

	it("reduces a low-level Cauchy-shaped impulse on pink noise", async () => {
		// Ruhland §III analytics predict ΔSNR from γ only for the RESIDUAL
		// path — the mask-rejected TF cells where the AR detector operates.
		// Loud transients whose TF footprint exceeds the adaptive threshold
		// are routed to the target (mask-kept) path and pass through bit-
		// for-bit by design (see design-declick "The load-bearing perceptual
		// property"). So a meaningful "click-reduction" test must use an
		// impulse whose TF footprint sits mostly below threshold — otherwise
		// the mask keeps it and BMRI is structurally a no-op on it.
		//
		// We inject a low-level Cauchy impulse at ~2× the pink-noise RMS and
		// assert the BMRI output at the impulse region has lower RMS than
		// the input (the impulse's mask-rejected content is AR-cleaned). The
		// reduction is modest because only the below-threshold portion of
		// the impulse goes through LSAR.
		const durationSec = 2;
		const n = SAMPLE_RATE * durationSec;
		const signal = makePinkNoise(n, 0xC1C5EED);

		const pinkRms = rms(signal);
		const targetRms = 0.1;
		const normScale = targetRms / Math.max(1e-12, pinkRms);

		for (let i = 0; i < n; i++) signal[i] *= normScale;

		const impulseCentre = 30_000;
		const impulseHalfWidth = 40;
		const impulsePeak = 2 * targetRms;
		const cauchyGamma = 3;

		for (let k = -impulseHalfWidth; k <= impulseHalfWidth; k++) {
			const i = impulseCentre + k;

			if (i < 0 || i >= n) continue;

			const cauchy = (cauchyGamma * cauchyGamma) / (k * k + cauchyGamma * cauchyGamma);

			signal[i] += impulsePeak * cauchy;
		}

		const input = signal.slice();

		const stream = deClick({ sensitivity: 0.5 }).createStream();
		const output = await runStreamOnMono(stream, signal.slice());

		const regionStart = impulseCentre - impulseHalfWidth;
		const regionEnd = impulseCentre + impulseHalfWidth + 1;
		const inputRmsRegion = rms(input, regionStart, regionEnd);
		const outputRmsRegion = rms(output, regionStart, regionEnd);
		const reductionDb = 20 * Math.log10(Math.max(1e-12, inputRmsRegion) / Math.max(1e-12, outputRmsRegion));

		// Any positive reduction confirms the pipeline is actually processing
		// the impulse region rather than passing the input through unchanged
		// or producing garbage. BMRI's ΔSNR on a single-sample impulse tail
		// that mostly falls under the mask is naturally small — we assert
		// only a small positive reduction to keep the test stable across
		// RNG variance.
		expect(reductionDb).toBeGreaterThan(0.1);
	}, 60_000);
});
