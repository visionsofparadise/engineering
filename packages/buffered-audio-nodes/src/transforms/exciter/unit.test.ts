import { describe, it, expect } from "vitest";
import { exciter, ExciterNode } from ".";
import { softShaper, tubeShaper, foldShaper, tapeShaper, applyShaper, type ExciterMode } from "./utils/shapers";
import { adaaShaper, ADAA_EPS, F0Soft, F0Tube, F0Fold, F0Tape } from "./utils/adaa";

const SAMPLE_RATE = 48000;

function makeConstantChunk(
	value: number,
	frames = 4096,
	channels = 1,
): { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number } {
	return {
		samples: Array.from({ length: channels }, () => new Float32Array(frames).fill(value)),
		offset: 0,
		sampleRate: SAMPLE_RATE,
		bitDepth: 32,
	};
}

function makeSinusoidChunk(
	freq: number,
	frames = 8192,
	channels = 1,
): { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number } {
	const samples = Array.from({ length: channels }, () => {
		const ch = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			ch[index] = Math.sin(2 * Math.PI * freq * index / SAMPLE_RATE);
		}

		return ch;
	});

	return { samples, offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
}

describe("ExciterNode", () => {
	it("has correct static metadata", () => {
		expect(ExciterNode.moduleName).toBe("Exciter");
	});

	it("schema defaults are correct", () => {
		const node = exciter();

		expect(node.properties.mode).toBe("soft");
		expect(node.properties.frequency).toBe(3000);
		expect(node.properties.drive).toBe(6);
		expect(node.properties.mix).toBe(0.5);
		expect(node.properties.harmonics).toBe(1);
		expect(node.properties.oversampling).toBe(2);
	});

	it("accepts custom parameters via factory", () => {
		const node = exciter({ mode: "tube", frequency: 5000, drive: 12, mix: 0.3 });

		expect(node.properties.mode).toBe("tube");
		expect(node.properties.frequency).toBe(5000);
		expect(node.properties.drive).toBe(12);
		expect(node.properties.mix).toBe(0.3);
	});

	it("mix=0: passes signal unchanged (dry only)", () => {
		const signal = 0.5;
		const node = exciter({ mix: 0, frequency: 1000, drive: 0 });
		const chunk = makeConstantChunk(signal);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		// With mix=0, output = dry, so all samples should equal input
		expect(output.samples[0]![output.samples[0]!.length - 1]).toBeCloseTo(signal, 4);
	});

	it("mix=1: output is fully wet (shaped signal only)", () => {
		// DC signal: high-pass will attenuate it, so output should differ from input
		const node = exciter({ mix: 1, frequency: 100, drive: 0, harmonics: 1 });
		const chunk = makeSinusoidChunk(5000); // well above crossover
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		// Output should differ from input (nonlinear transformation applied)
		const inRms = rms(chunk.samples[0]!);
		const outRms = rms(output.samples[0]!);

		// With drive=0 and soft shaper, output ≤ input (saturation compresses)
		expect(outRms).toBeLessThanOrEqual(inRms + 0.01);
		expect(output.samples[0]).toHaveLength(chunk.samples[0]!.length);
	});

	it("output differs from input for each mode (audio-shape contract)", () => {
		const modes = ["soft", "tube", "fold"] as const;

		for (const mode of modes) {
			const node = exciter({ mode, mix: 1, frequency: 200, drive: 12, harmonics: 1 });
			const chunk = makeSinusoidChunk(1000);
			const stream = node.createStream();
			const output = stream._unbuffer(chunk);

			const inRms = rms(chunk.samples[0]!);
			const outRms = rms(output.samples[0]!);

			// Shaped output should differ from input
			// The two RMS values should not be trivially identical
			expect(Math.abs(outRms - inRms)).toBeGreaterThan(0.001);
		}
	});

	it("mode switching produces different outputs", () => {
		const chunk = makeSinusoidChunk(5000, 4096);

		const softNode = exciter({ mode: "soft", mix: 1, frequency: 200, drive: 12 });
		const tubeNode = exciter({ mode: "tube", mix: 1, frequency: 200, drive: 12 });
		const foldNode = exciter({ mode: "fold", mix: 1, frequency: 200, drive: 12 });

		const outSoft = softNode.createStream()._unbuffer(chunk);
		const outTube = tubeNode.createStream()._unbuffer(chunk);
		const outFold = foldNode.createStream()._unbuffer(chunk);

		const rmsSoft = rms(outSoft.samples[0]!);
		const rmsTube = rms(outTube.samples[0]!);
		const rmsFold = rms(outFold.samples[0]!);

		// All three modes should produce different output levels
		expect(Math.abs(rmsSoft - rmsTube)).toBeGreaterThan(0.001);
		expect(Math.abs(rmsSoft - rmsFold)).toBeGreaterThan(0.001);
	});

	it("harmonics multiplier scales shaped output", () => {
		const chunk = makeSinusoidChunk(5000, 4096);

		const node1 = exciter({ harmonics: 0.5, mix: 1, frequency: 200, drive: 6 });
		const node2 = exciter({ harmonics: 2.0, mix: 1, frequency: 200, drive: 6 });

		const out1 = node1.createStream()._unbuffer(chunk);
		const out2 = node2.createStream()._unbuffer(chunk);

		const rms1 = rms(out1.samples[0]!);
		const rms2 = rms(out2.samples[0]!);

		// Higher harmonics multiplier should produce louder output
		expect(rms2).toBeGreaterThan(rms1);
	});

	it("frequency crossover: does not excite signal below crossover", () => {
		// A low-frequency signal below the crossover should be barely affected
		// because the high-pass filter will attenuate the excited band significantly
		const lowFreq = 50;
		const crossover = 3000;

		const dryNode = exciter({ mix: 0, frequency: crossover });
		const wetNode = exciter({ mix: 1, frequency: crossover, drive: 12, harmonics: 1 });

		const chunk = makeSinusoidChunk(lowFreq);
		const dryOut = dryNode.createStream()._unbuffer(chunk);
		const wetOut = wetNode.createStream()._unbuffer(chunk);

		const dryRms = rms(dryOut.samples[0]!);
		const wetRms = rms(wetOut.samples[0]!);

		// Below crossover: the excited band (HP) carries very little energy.
		// mix=1 outputs only the wet signal. That should be much quieter than the dry.
		expect(wetRms).toBeLessThan(dryRms * 0.1);
	});

	it("processes stereo input without errors", () => {
		const node = exciter();
		const chunk = makeSinusoidChunk(5000, 4096, 2);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		expect(output.samples).toHaveLength(2);
		expect(output.samples[0]).toHaveLength(4096);
		expect(output.samples[1]).toHaveLength(4096);
	});

	it("produces finite output values", () => {
		const node = exciter({ drive: 24 });
		const chunk = makeConstantChunk(0.9);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("handles empty chunk gracefully", () => {
		const node = exciter();
		const emptyChunk = { samples: [] as Array<Float32Array>, offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const stream = node.createStream();
		const output = stream._unbuffer(emptyChunk);

		expect(output.samples).toHaveLength(0);
	});

	it("type identifier is correct", () => {
		const node = exciter();

		expect(node.type[2]).toBe("exciter");
	});

	it("clone preserves and can override properties", () => {
		const node = exciter({ mode: "tube", drive: 12 });
		const cloned = node.clone({ drive: 6 });

		expect(cloned.properties.mode).toBe("tube");
		expect(cloned.properties.drive).toBe(6);
	});
});

describe("Oversampling integration (exciter default 2x; can be disabled with oversampling: 1)", () => {
	it("oversampling=1 skips oversampling and produces different output from oversampling=2", () => {
		// oversampling=1 must take the non-oversampled path (shaper applied
		// directly at original rate). Its output must differ from the default
		// 2x path on a high-frequency driven signal where aliasing matters.
		const frames = 4096;
		const freqHz = 5000;
		const sineData = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			sineData[index] = Math.sin((2 * Math.PI * freqHz * index) / SAMPLE_RATE);
		}

		const chunk = { samples: [sineData], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const direct = exciter({ mode: "soft", drive: 18, mix: 1, frequency: 200, harmonics: 1, oversampling: 1 });
		const over = exciter({ mode: "soft", drive: 18, mix: 1, frequency: 200, harmonics: 1, oversampling: 2 });

		const sDirect = direct.createStream();
		const sOver = over.createStream();

		// Warm up
		for (let rep = 0; rep < 5; rep++) {
			sDirect._unbuffer(chunk);
			sOver._unbuffer(chunk);
		}

		const outDirect = sDirect._unbuffer(chunk).samples[0]!;
		const outOver = sOver._unbuffer(chunk).samples[0]!;

		for (const sample of outDirect) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		for (const sample of outOver) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		let maxDiff = 0;

		for (let index = 0; index < frames; index++) {
			const diff = Math.abs((outDirect[index] ?? 0) - (outOver[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		expect(maxDiff).toBeGreaterThan(0.001);
	});


	it("all modes produce finite output with oversampling active", () => {
		const modes = ["soft", "tube", "fold"] as const;

		for (const mode of modes) {
			const node = exciter({ mode, drive: 18, mix: 1, frequency: 200, harmonics: 1 });
			const chunk = makeSinusoidChunk(5000, 4096);
			const stream = node.createStream();

			// Warm up the oversampler
			for (let rep = 0; rep < 3; rep++) {
				stream._unbuffer(chunk);
			}

			const output = stream._unbuffer(chunk);

			for (const sample of output.samples[0]!) {
				expect(Number.isFinite(sample)).toBe(true);
			}
		}
	});

	it("oversampled exciter output differs from direct (non-oversampled) shaper application", () => {
		// When oversampling is active, the shaper runs at 2x rate, which
		// reduces aliasing. For a high-drive signal at a significant frequency,
		// the output should differ from direct per-sample shaping because the
		// oversampler applies LP filtering before and after the nonlinearity.
		const frames = 4096;
		const freqHz = 5000;
		const sineData = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			sineData[index] = Math.sin((2 * Math.PI * freqHz * index) / SAMPLE_RATE);
		}

		// Oversampled exciter (always-on 2x in ExciterStream)
		const node = exciter({ mode: "soft", drive: 18, mix: 1, frequency: 200, harmonics: 1 });
		const chunk = { samples: [sineData], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const stream = node.createStream();

		// Warm up
		for (let rep = 0; rep < 5; rep++) {
			stream._unbuffer(chunk);
		}

		const oversampledOutput = stream._unbuffer(chunk).samples[0]!;

		// Direct reference: apply drive and shaper sample-by-sample without oversampling
		// (no anti-aliasing LP filter, no interpolation — just a raw nonlinear pass)
		const driveLinear = Math.pow(10, 18 / 20);
		const directOutput = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			directOutput[index] = applyShaper((sineData[index] ?? 0) * driveLinear, "soft");
		}

		// Both should be finite
		for (const sample of oversampledOutput) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		// Oversampled output should differ from direct (LP filtering changes the signal)
		let maxDiff = 0;

		for (let index = 0; index < frames; index++) {
			const diff = Math.abs((oversampledOutput[index] ?? 0) - (directOutput[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		expect(maxDiff).toBeGreaterThan(0.001);
	});
});

describe("Transfer curve shapers", () => {
	it("softShaper: y = x / (1 + |x|)", () => {
		expect(softShaper(0)).toBe(0);
		expect(softShaper(1)).toBeCloseTo(0.5, 5);
		expect(softShaper(-1)).toBeCloseTo(-0.5, 5);
		// Large values converge toward ±1 (1000/1001 ≈ 0.999)
		expect(softShaper(1000)).toBeCloseTo(1, 2);
		expect(softShaper(-1000)).toBeCloseTo(-1, 2);
	});

	it("softShaper: output is always bounded within (-1, 1)", () => {
		const values = [-100, -2, -0.5, 0, 0.5, 2, 100];

		for (const value of values) {
			const result = softShaper(value);

			expect(result).toBeGreaterThan(-1);
			expect(result).toBeLessThan(1);
		}
	});

	it("softShaper: odd symmetry f(-x) = -f(x)", () => {
		const values = [0.1, 0.5, 1, 2, 5];

		for (const value of values) {
			expect(softShaper(-value)).toBeCloseTo(-softShaper(value), 8);
		}
	});

	it("tubeShaper: zero input produces zero output", () => {
		expect(tubeShaper(0)).toBe(0);
	});

	it("tubeShaper: clamps to ±1 for |x| >= 1", () => {
		expect(tubeShaper(1)).toBe(1);
		expect(tubeShaper(-1)).toBe(-1);
		expect(tubeShaper(2)).toBe(1);
		expect(tubeShaper(-2)).toBe(-1);
	});

	it("tubeShaper: y = x * (1.5 - 0.5 * x^2) for |x| < 1", () => {
		const testValues = [0.1, 0.3, 0.5, 0.7, 0.9];

		for (const value of testValues) {
			const expected = value * (1.5 - 0.5 * value * value);

			expect(tubeShaper(value)).toBeCloseTo(expected, 8);
		}
	});

	it("foldShaper: y = sin(x * π/2)", () => {
		expect(foldShaper(0)).toBeCloseTo(0, 8);
		expect(foldShaper(1)).toBeCloseTo(1, 8);
		expect(foldShaper(-1)).toBeCloseTo(-1, 8);
		expect(foldShaper(2)).toBeCloseTo(0, 6); // sin(π) ≈ 0
		expect(foldShaper(3)).toBeCloseTo(-1, 6); // sin(3π/2) = -1
	});

	it("applyShaper dispatches to the correct curve by mode", () => {
		const sample = 0.5;

		expect(applyShaper(sample, "soft")).toBeCloseTo(softShaper(sample), 8);
		expect(applyShaper(sample, "tube")).toBeCloseTo(tubeShaper(sample), 8);
		expect(applyShaper(sample, "fold")).toBeCloseTo(foldShaper(sample), 8);
		expect(applyShaper(sample, "tape")).toBeCloseTo(tapeShaper(sample, 1), 8);
	});

	it("tapeShaper: zero input produces zero output (DC correction)", () => {
		// With DC correction `- tanh(bias)`, tapeShaper(0, drive) must be 0
		// regardless of drive — this is the property that keeps a biased tanh
		// from introducing a DC offset.
		expect(tapeShaper(0, 1)).toBeCloseTo(0, 10);
		expect(tapeShaper(0, 2)).toBeCloseTo(0, 10);
		expect(tapeShaper(0, 8)).toBeCloseTo(0, 10);
	});

	it("tapeShaper: asymmetric transfer curve (positive vs negative inputs differ in magnitude)", () => {
		// Biased tanh is asymmetric about zero — |f(x)| != |f(-x)| for x != 0.
		// This asymmetry is what produces the 2nd-harmonic-dominant tape
		// character, versus the purely odd (3rd-harmonic) soft/tube/fold curves.
		const positive = tapeShaper(0.5, 1);
		const negative = tapeShaper(-0.5, 1);

		expect(Math.abs(Math.abs(positive) - Math.abs(negative))).toBeGreaterThan(1e-3);
	});

	it("tapeShaper: produces finite output for a wide input range", () => {
		const edgeCases = [0, 1, -1, 0.0001, -0.0001, 10, -10];

		for (const value of edgeCases) {
			expect(Number.isFinite(tapeShaper(value, 1))).toBe(true);
			expect(Number.isFinite(tapeShaper(value, 4))).toBe(true);
		}
	});

	it("all shapers produce finite output for edge-case inputs", () => {
		const modes = ["soft", "tube", "fold", "tape"] as const;
		const edgeCases = [0, 1, -1, 0.0001, -0.0001, 10, -10];

		for (const mode of modes) {
			for (const value of edgeCases) {
				const result = applyShaper(value, mode);

				expect(Number.isFinite(result)).toBe(true);
			}
		}
	});
});

describe("ExciterNode tape mode", () => {
	it("schema accepts mode='tape'", () => {
		const node = exciter({ mode: "tape" });

		expect(node.properties.mode).toBe("tape");
	});

	it("tape mode produces non-zero, finite output for a non-zero input", () => {
		const node = exciter({ mode: "tape", mix: 1, frequency: 200, drive: 12, harmonics: 1 });
		const chunk = makeSinusoidChunk(1000);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		const outRms = rms(output.samples[0]!);

		expect(outRms).toBeGreaterThan(0);
	});

	it("tape mode output differs from tube mode at matched settings (asymmetric vs symmetric)", () => {
		// Tape is biased-tanh + HF rolloff; tube is symmetric cubic soft-clip.
		// With identical drive / frequency / mix, the two outputs should be
		// distinguishable at the sample level — this is the behavioral
		// claim that justifies adding tape as its own mode.
		const chunk = makeSinusoidChunk(1000, 4096);

		const tapeNode = exciter({ mode: "tape", mix: 1, frequency: 200, drive: 12, harmonics: 1 });
		const tubeNode = exciter({ mode: "tube", mix: 1, frequency: 200, drive: 12, harmonics: 1 });

		const outTape = tapeNode.createStream()._unbuffer(chunk).samples[0]!;
		const outTube = tubeNode.createStream()._unbuffer(chunk).samples[0]!;

		let maxDiff = 0;

		for (let index = 0; index < outTape.length; index++) {
			const diff = Math.abs((outTape[index] ?? 0) - (outTube[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		expect(maxDiff).toBeGreaterThan(1e-3);
	});
});

describe("ADAA antiderivatives", () => {
	// Numerical verification per action 1.1 — differentiate F0 and compare to
	// the pointwise shaper on a dense grid in [-10, 10]. The centred finite
	// difference is exact to O(h²) for smooth shapers; `tube`'s |x|=1 corner
	// and `soft`'s |x| kink at 0 are skipped because the derivative is
	// undefined there.
	const step = 1e-6;
	const grid: Array<number> = [];

	for (let value = -10; value <= 10.0001; value += 0.01) {
		grid.push(value);
	}

	function numericalDerivative(fn: (x: number) => number, x: number): number {
		return (fn(x + step) - fn(x - step)) / (2 * step);
	}

	it("F0Soft pins to 0 at origin", () => {
		expect(F0Soft(0)).toBe(0);
	});

	it("F0Soft differentiates to softShaper across x ∈ [-10, 10]", () => {
		let maxError = 0;

		for (const x of grid) {
			// Skip a small neighbourhood of 0 where |x| has a kink.
			if (Math.abs(x) < 1e-3) continue;

			const error = Math.abs(numericalDerivative(F0Soft, x) - softShaper(x));

			if (error > maxError) maxError = error;
		}

		expect(maxError).toBeLessThan(1e-7);
	});

	it("F0Tube pins to 0 at origin and differentiates to tubeShaper", () => {
		expect(F0Tube(0)).toBe(0);

		let maxError = 0;

		for (const x of grid) {
			// Skip small neighbourhoods around |x| = 1 where the piecewise
			// shaper has a corner.
			if (Math.abs(Math.abs(x) - 1) < 1e-3) continue;

			const error = Math.abs(numericalDerivative(F0Tube, x) - tubeShaper(x));

			if (error > maxError) maxError = error;
		}

		expect(maxError).toBeLessThan(1e-7);
	});

	it("F0Fold pins to 0 at origin and differentiates to foldShaper", () => {
		expect(F0Fold(0)).toBeCloseTo(0, 12);

		let maxError = 0;

		for (const x of grid) {
			const error = Math.abs(numericalDerivative(F0Fold, x) - foldShaper(x));

			if (error > maxError) maxError = error;
		}

		expect(maxError).toBeLessThan(1e-7);
	});

	it("F0Tape pins to 0 at origin and differentiates to tapeShaper(·, 1)", () => {
		expect(F0Tape(0)).toBeCloseTo(0, 12);

		let maxError = 0;

		for (const x of grid) {
			const error = Math.abs(numericalDerivative(F0Tape, x) - tapeShaper(x, 1));

			if (error > maxError) maxError = error;
		}

		expect(maxError).toBeLessThan(1e-7);
	});
});

describe("adaaShaper (first-order ADAA, Parker-Zavalishin 2016 Eq. 9)", () => {
	const modes: Array<ExciterMode> = ["soft", "tube", "fold", "tape"];

	it("ill-conditioned fallback: x_n ≈ x_{n-1} produces non-NaN output at the sample mean", () => {
		// When |Δx| < ADAA_EPS, Eq. 9 divides two nearly-equal values; the
		// Eq. 10 fallback evaluates the shaper at the midpoint instead. A
		// perfectly-constant input is the worst case — without the fallback
		// this would be 0/0.
		for (const mode of modes) {
			const y = adaaShaper(0.3, 0.3, mode);

			expect(Number.isFinite(y)).toBe(true);
			// At the sample mean (0.3 here), the fallback returns the raw
			// shaper value.
			expect(y).toBeCloseTo(applyShaper(0.3, mode), 10);
		}
	});

	it("ill-conditioned fallback engages for |Δx| < ADAA_EPS", () => {
		// Just below the threshold: fallback; just above: Eq. 9.
		const belowDelta = ADAA_EPS * 0.5;
		const aboveDelta = ADAA_EPS * 1.5;

		for (const mode of modes) {
			const xCenter = 0.25;
			const belowResult = adaaShaper(xCenter + belowDelta, xCenter, mode);
			const aboveResult = adaaShaper(xCenter + aboveDelta, xCenter, mode);

			expect(Number.isFinite(belowResult)).toBe(true);
			expect(Number.isFinite(aboveResult)).toBe(true);
			// Both paths should produce nearly the same value — they agree to
			// O((Δx)²) by construction. At Δx ~ ADAA_EPS ~ 1e-5 we expect
			// agreement well below the Float32 epsilon (~1e-7 relative), but
			// Eq. 9 itself loses ~5 digits of Float64 precision at this Δx,
			// so the comparison is dominated by Eq. 9's roundoff.
			expect(Math.abs(belowResult - aboveResult)).toBeLessThan(1e-4);
		}
	});

	it("low-signal limit: adaaShaper(x, x_prev) ≈ (x + x_prev)/2 for small signals (Eq. 17)", () => {
		// Parker-Zavalishin §4 Eq. 17: at low signal levels where f(x) ≈ x,
		// the first-order ADAA rule becomes a half-sample fractional delay
		// implemented as a two-tap box filter. All four shapers satisfy
		// f(x) ≈ x near the origin, so adaaShaper should match (x + x_prev)/2
		// for small x.
		for (const mode of modes) {
			const x = 1e-4;
			const xPrev = -1e-4;
			const expected = 0.5 * (x + xPrev);
			const y = adaaShaper(x, xPrev, mode);

			expect(y).toBeCloseTo(expected, 6);
		}
	});

	it("agrees with raw Eq. 9 when |Δx| is comfortably above the threshold", () => {
		// Verify our implementation matches the direct formula on a
		// well-conditioned pair. Using `soft` for a closed-form check.
		const xNow = 0.8;
		const xPrev = 0.2;
		const expected = (F0Soft(xNow) - F0Soft(xPrev)) / (xNow - xPrev);

		expect(adaaShaper(xNow, xPrev, "soft")).toBeCloseTo(expected, 12);
	});
});

describe("ExciterNode ADAA integration", () => {
	it("DC input: every sample feeds the ADAA fallback; output is finite and bounded", () => {
		// A perfectly-constant input makes |Δx| = 0 at every step (worst case
		// for Eq. 9). With the Eq. 10 fallback in place, the shaped signal
		// should be finite and free of NaN / Inf. The HP filter attenuates DC,
		// so after warmup the driven band is ~0 and the shaper output is ~0.
		const node = exciter({ mode: "soft", mix: 1, frequency: 1000, drive: 12, harmonics: 1, oversampling: 1 });
		const chunk = makeConstantChunk(0.5);
		const stream = node.createStream();

		// Warm the HP filter so its transient decays.
		for (let rep = 0; rep < 3; rep++) {
			stream._unbuffer(chunk);
		}

		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("sine at fs/4: ADAA output differs from the pointwise shaper output (not a no-op)", () => {
		// At fs/4, a unit-amplitude sine changes enough per sample that most
		// calls use Eq. 9 rather than the fallback, so the difference from
		// the pointwise path is a real ADAA effect, not numerical noise.
		const frames = 4096;
		const fsOver4 = SAMPLE_RATE / 4;
		const sineData = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			sineData[index] = Math.sin((2 * Math.PI * fsOver4 * index) / SAMPLE_RATE);
		}

		const chunk = { samples: [sineData], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const node = exciter({ mode: "fold", mix: 1, frequency: 200, drive: 18, harmonics: 1, oversampling: 1 });
		const stream = node.createStream();

		// Warm up so oversampler LP states settle. Even at factor 1, there is
		// still the HP filter state to settle.
		for (let rep = 0; rep < 5; rep++) {
			stream._unbuffer(chunk);
		}

		const output = stream._unbuffer(chunk).samples[0]!;

		// Direct path: raw shaper applied per sample with the same drive.
		const driveLinear = Math.pow(10, 18 / 20);
		const direct = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			direct[index] = applyShaper((sineData[index] ?? 0) * driveLinear, "fold");
		}

		// ADAA output and pointwise output must not be identical on this
		// high-frequency high-drive signal.
		let maxDiff = 0;

		for (let index = 0; index < frames; index++) {
			const diff = Math.abs((output[index] ?? 0) - (direct[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		expect(maxDiff).toBeGreaterThan(0.01);

		// All samples finite.
		for (const sample of output) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("ADAA state persists across chunks (split processing matches single-chunk reference)", () => {
		// Process the same sine as (a) one big chunk and (b) two consecutive
		// half-sized chunks; the outputs must match to near-Float32 precision.
		// Any reset of the ADAA `x_{n-1}` register (or any other per-sample
		// state like the HP-filter or dry-path-delay register) at the chunk
		// boundary would produce a discontinuity at sample `totalFrames/2`
		// of the split run that is absent from the single-chunk reference,
		// blowing the tolerance by orders of magnitude. The previous loose
		// absolute-tolerance check could pass even if state did reset — at
		// 2 kHz / 48 kHz the sample-to-sample delta of a unit sine is ~0.26,
		// well under a 0.5 tolerance.
		const totalFrames = 2048;
		const freqHz = 2000;
		const generateSine = (offsetSamples: number, frames: number): AudioChunk => {
			const data = new Float32Array(frames);

			for (let index = 0; index < frames; index++) {
				data[index] = Math.sin((2 * Math.PI * freqHz * (index + offsetSamples)) / SAMPLE_RATE);
			}

			return { samples: [data], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		};
		const options = { mode: "soft" as const, mix: 1, frequency: 200, drive: 12, harmonics: 1, oversampling: 1 as const };

		// Reference: one chunk of totalFrames.
		const referenceStream = exciter(options).createStream();
		const reference = referenceStream._unbuffer(generateSine(0, totalFrames));
		const referenceSamples = reference.samples[0]!;

		// Split: two chunks of totalFrames/2 each.
		const half = totalFrames / 2;
		const splitStream = exciter(options).createStream();
		const splitA = splitStream._unbuffer(generateSine(0, half));
		const splitB = splitStream._unbuffer(generateSine(half, half));
		const splitSamples = new Float32Array(totalFrames);

		splitSamples.set(splitA.samples[0]!, 0);
		splitSamples.set(splitB.samples[0]!, half);

		// Tolerance at the Float32 floor — the exciter stores samples as
		// Float32, so bit-identical agreement is not expected (arithmetic
		// order differences across the split boundary map through the
		// Float32 round-trip). A state reset at the boundary would produce
		// per-sample errors of order 0.1–1.0, many orders of magnitude
		// above this tolerance.
		let maxDiff = 0;

		for (let index = 0; index < totalFrames; index++) {
			const diff = Math.abs((referenceSamples[index] ?? 0) - (splitSamples[index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		expect(maxDiff).toBeLessThan(1e-6);
	});
});

type AudioChunk = { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number };

function rms(channel: Float32Array): number {
	const half = Math.floor(channel.length / 2);
	let sum = 0;

	for (let index = half; index < channel.length; index++) {
		sum += (channel[index] ?? 0) ** 2;
	}

	return Math.sqrt(sum / (channel.length - half));
}
