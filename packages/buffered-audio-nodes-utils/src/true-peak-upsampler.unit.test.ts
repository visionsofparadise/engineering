import { describe, expect, it } from "vitest";
import { TruePeakUpsampler } from "./true-peak-upsampler";

const PHASES = 4;
const TAPS = 12;

function makeSine(freqHz: number, amplitude: number, sampleRate: number, frames: number, phase = 0): Float32Array {
	const out = new Float32Array(frames);

	for (let i = 0; i < frames; i++) {
		out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate + phase);
	}

	return out;
}

function maxAbs(signal: Float32Array, start = 0): number {
	let m = 0;

	for (let i = start; i < signal.length; i++) {
		const a = Math.abs(signal[i] ?? 0);

		if (a > m) m = a;
	}

	return m;
}

describe("TruePeakUpsampler (BS.1770-4 Annex 1 polyphase FIR)", () => {
	// Feeding a single 1.0 sample preceded by zeros and then padding
	// with zeros lets us read the impulse response straight out of the
	// output buffer. Phase 0 is the identity tap (output[0] = 1.0).
	// Phase p at sample n corresponds to coefficient[phase=p][tap=n].
	it("impulse response matches the published phase coefficients", () => {
		const upsampler = new TruePeakUpsampler(4);
		// Drive 12 input samples: a 1.0 followed by 11 zeros, then
		// trailing zeros to flush. After processing input index n, the
		// output block at indices [n*4, n*4+3] uses x[n], x[n-1], ...
		// so the impulse response of phase p at input-index n is in
		// output[n*4 + p].
		const input = new Float32Array(TAPS);

		input[0] = 1.0;

		const out = upsampler.upsample(input);

		// Phase 0 first output should be exactly 1.0 (identity tap).
		expect(out[0]).toBe(1.0);

		// Phases 1..3: tap k corresponds to output position
		// (k * PHASES + phase). The newest sample (the 1.0) was fed at
		// input index 0 — at input index k it sits k positions back in
		// the history, weighted by coefficient[phase][k].
		const expectedCoefficients: Array<Array<number>> = [
			[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
			[
				0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125,
				-0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875,
				0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500,
			],
			[
				-0.0291748046875, 0.029296875, -0.05175781250, 0.0891113281250,
				-0.166503906250, 0.4650878906250, 0.77978515625, -0.2003173828125,
				0.10156250000, -0.0582275390625, 0.0330810546875, -0.0189208984375,
			],
			[
				-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.10156250000,
				-0.2003173828125, 0.77978515625, 0.4650878906250, -0.166503906250,
				0.0891113281250, -0.05175781250, 0.029296875, -0.0291748046875,
			],
		];

		for (let phase = 0; phase < PHASES; phase++) {
			for (let tap = 0; tap < TAPS; tap++) {
				const outIdx = tap * PHASES + phase;
				const expected = expectedCoefficients[phase]?.[tap] ?? 0;
				const actual = out[outIdx] ?? 0;

				expect(actual).toBeCloseTo(expected, 5);
			}
		}
	});

	// Constant input. After the 12-tap transient the upsampled output
	// converges to roughly the input DC value. The BS.1770-4 Annex 1
	// FIR phases do not have unity DC gain per phase by construction
	// — the spec optimises for passband response inside a defined
	// band, not for flat DC across all four phases — so steady-state
	// per-phase outputs come within ~3% of the input. Empirically:
	// phase 0 = identity (exact); phase 1 ≈ 0.5008; phase 2 ≈ 0.4865
	// (sum ≈ 0.973); phase 3 ≈ 0.5008 (mirror of phase 1).
	// Well within true-peak measurement tolerance (true peak picks
	// max across all phases — the under-shooting phases never win the
	// max). The test asserts the looser ~3% bound that the spec
	// actually delivers.
	it("DC at 0.5 is preserved (within ~3%) after the FIR transient settles", () => {
		const upsampler = new TruePeakUpsampler(4);
		const input = new Float32Array(64).fill(0.5);
		const out = upsampler.upsample(input);

		// Skip the first 12 input samples worth of output (48 frames).
		for (let i = 12 * 4; i < out.length; i++) {
			expect(Math.abs((out[i] ?? 0) - 0.5)).toBeLessThan(0.02);
		}
	});

	// A 1 kHz sine at 48 kHz with non-integer samples-per-cycle. After
	// the FIR settles, the upsampled max should sit ≈ amplitude (no
	// systematic loss, modest intersample-peak lift).
	it("1 kHz sine at 0.5 amplitude has upsampled peak ≈ 0.5", () => {
		const sampleRate = 48000;
		const frames = sampleRate; // 1 s
		const sine = makeSine(1000, 0.5, sampleRate, frames);
		const upsampler = new TruePeakUpsampler(4);
		const out = upsampler.upsample(sine);

		const peak = maxAbs(out, TAPS * 4);

		expect(peak).toBeGreaterThan(0.49);
		expect(peak).toBeLessThan(0.55);
	});

	// Inter-sample peak recovery: a sine just below Nyquist with a
	// half-sample phase offset places true peaks between sample-grid
	// points. The sample-grid peak comes in below the actual amplitude
	// (since the maxima fall between samples); a spec-compliant 4×
	// upsampler recovers a peak much closer to the true amplitude.
	it("inter-sample peak: sine just below Nyquist with phase offset is recovered above the sample-grid peak", () => {
		const sampleRate = 48000;
		const amplitude = 1.0;
		// Sine at fs/4 - a few hundred Hz, phase π/4 — the sample-grid
		// peak sits below `amplitude` because the maxima land between
		// samples. A spec-compliant 4× upsampler should bring the
		// recovered peak well above the sample-grid peak.
		const freqHz = sampleRate / 4 - 100;
		const frames = 4096;
		const input = makeSine(freqHz, amplitude, sampleRate, frames, Math.PI / 4);

		// Sample-grid peak baseline.
		const samplePeak = maxAbs(input);

		const upsampler = new TruePeakUpsampler(4);
		const out = upsampler.upsample(input);

		// Skip the FIR ramp-up.
		const truePeak = maxAbs(out, TAPS * 4);

		expect(truePeak).toBeGreaterThan(samplePeak);
		// True peak should sit close to the actual amplitude (1.0)
		// with some FIR-imposed slack — the 4× grid still doesn't hit
		// the exact maximum, but it is much closer than the original
		// sample grid.
		expect(truePeak).toBeGreaterThan(0.95);
		expect(truePeak).toBeLessThan(1.05);
	});

	// State carries across `upsample()` calls. Feeding an input in two
	// halves must produce byte-identical output to feeding it whole.
	it("streaming continuity: two halves match a single push (byte-identical)", () => {
		const sine = makeSine(1234, 0.7, 48000, 8192);

		const whole = new TruePeakUpsampler(4).upsample(sine);

		const half = sine.length / 2;
		const streaming = new TruePeakUpsampler(4);
		const first = streaming.upsample(sine.subarray(0, half));
		const second = streaming.upsample(sine.subarray(half));

		expect(first.length + second.length).toBe(whole.length);

		for (let i = 0; i < first.length; i++) {
			expect(first[i]).toBe(whole[i]);
		}

		for (let i = 0; i < second.length; i++) {
			expect(second[i]).toBe(whole[first.length + i]);
		}
	});

	// reset() should clear state so the same input produces the same
	// fresh-stream output as a brand-new instance.
	it("reset() restores a cold filter state", () => {
		const sine = makeSine(1000, 0.5, 48000, 4096);

		const fresh = new TruePeakUpsampler(4).upsample(sine);

		const reused = new TruePeakUpsampler(4);

		reused.upsample(sine); // pollute state
		reused.reset();

		const afterReset = reused.upsample(sine);

		for (let i = 0; i < fresh.length; i++) {
			expect(afterReset[i]).toBe(fresh[i]);
		}
	});

	it("output length is input length × factor", () => {
		const upsampler = new TruePeakUpsampler(4);
		const input = new Float32Array(1024);
		const out = upsampler.upsample(input);

		expect(out.length).toBe(1024 * 4);
	});

	it("empty input returns empty output", () => {
		const upsampler = new TruePeakUpsampler(4);
		const out = upsampler.upsample(new Float32Array(0));

		expect(out.length).toBe(0);
	});

	it("unsupported factors throw", () => {
		expect(() => new TruePeakUpsampler(8)).toThrow();
		expect(() => new TruePeakUpsampler(16)).toThrow();
	});

	it("all output samples are finite for typical input", () => {
		const upsampler = new TruePeakUpsampler(4);
		const sine = makeSine(997, 0.9, 48000, 4096);
		const out = upsampler.upsample(sine);

		for (let i = 0; i < out.length; i++) {
			expect(Number.isFinite(out[i] ?? 0)).toBe(true);
		}
	});
});
