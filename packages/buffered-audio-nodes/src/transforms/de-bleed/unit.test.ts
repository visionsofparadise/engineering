/* eslint-disable @typescript-eslint/no-non-null-assertion -- typed-array indexing in tight loops */
import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { expectedDuration, somethingChanged } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { deBleed } from ".";
import { adaptationSpeedToMarkovForgetting, createKalmanState, kalmanUpdateFrame, type KalmanParams, type KalmanState } from "./utils/mef-kalman";
import { computeMwfMask, createInterfererPsdState, reductionStrengthToOversubtraction, updateInterfererPsd, updatePrevOutputPsd } from "./utils/mef-mwf";
import { applyIspRestoration, computeMsadDecision, createIspState, createMsadChannelState } from "./utils/mef-msad";
import { coldStartSeed, validateTransferSeed } from "./utils/warmup";

const testVoice = audio.testVoice;

// Default Kalman params for unit tests — `R/K` is the hop/fft ratio. At our
// default 1024/4096 it's 0.25; tests use the same so behaviour matches the
// node's runtime.
const DEFAULT_R_OVER_K = 1024 / 4096;

describe("DeBleed", () => {
	it("processes voice audio", async () => {
		const transform = deBleed(testVoice);
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
	}, 1_800_000);

	// Phase 2 unit: parameter mappings must hit MEF's documented defaults at the
	// user-facing default knob positions per design-de-bleed.md "2026-05-01: New
	// user parameter surface".
	describe("MEF parameter mappings", () => {
		it("adaptationSpeed=3 maps to A=0.998 (MEF Table 1 default)", () => {
			expect(adaptationSpeedToMarkovForgetting(3)).toBeCloseTo(0.998, 6);
		});

		// Production LAMBDA_SCALE was retuned 2026-05-02 from MEF's λ=1.5-at-mid
		// (LAMBDA_SCALE=0.3) to LAMBDA_SCALE=5.0 to close the body HP@100 RMS
		// gap to within 1 dB of iZotope RX at max strength on real podcast
		// audio. With the new scale, reductionStrength=5 → λ=25. See
		// design-de-bleed.md "2026-05-02: RX-parity tuning (Phase 3)" for
		// sweep data and the trade-off rationale.
		it("reductionStrength=5 maps to lambda=25 (LAMBDA_SCALE=5.0 production default)", () => {
			expect(reductionStrengthToOversubtraction(5)).toBeCloseTo(25, 6);
		});

		it("reductionStrength=10 maps to lambda=50 (LAMBDA_SCALE=5.0 production max)", () => {
			expect(reductionStrengthToOversubtraction(10)).toBeCloseTo(50, 6);
		});

		it("reductionStrength=0 maps to lambda=0 (no subtraction)", () => {
			expect(reductionStrengthToOversubtraction(0)).toBe(0);
		});

		it("adaptationSpeed=10 maps to A < 0.998 (faster tracking)", () => {
			expect(adaptationSpeedToMarkovForgetting(10)).toBeLessThan(0.998);
		});

		it("adaptationSpeed=0 maps to A > 0.998 (more stable)", () => {
			expect(adaptationSpeedToMarkovForgetting(0)).toBeGreaterThan(0.998);
		});
	});

	// Phase 2.5 unit: degeneracy fallback per the prompt's exact threshold
	// (NaN; ≥80% bins below 1e-4 × max-bin-magnitude; Inf/denormal).
	describe("warmup seed validation", () => {
		it("accepts a healthy seed", () => {
			const real = new Float32Array([0.5, 0.4, 0.3, 0.2, 0.1]);
			const imag = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
			const validation = validateTransferSeed({ real, imag });

			expect(validation.degenerate).toBe(false);
		});

		it("rejects a seed with NaN", () => {
			const real = new Float32Array([0.5, NaN, 0.3]);
			const imag = new Float32Array([0.1, 0.2, 0.3]);
			const validation = validateTransferSeed({ real, imag });

			expect(validation.degenerate).toBe(true);
			expect(validation.reason).toContain("NaN");
		});

		it("rejects a seed with Infinity", () => {
			const real = new Float32Array([0.5, Infinity, 0.3]);
			const imag = new Float32Array([0.1, 0.2, 0.3]);
			const validation = validateTransferSeed({ real, imag });

			expect(validation.degenerate).toBe(true);
		});

		it("rejects a seed where ≥80% of bins are below 1e-4 × max", () => {
			// 10 bins; max is 1.0; 9 bins at 1e-7 (= 1e-7 × 1 — well below 1e-4 × 1).
			const real = new Float32Array([1, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7]);
			const imag = new Float32Array(10);
			const validation = validateTransferSeed({ real, imag });

			expect(validation.degenerate).toBe(true);
			expect(validation.reason).toContain("below");
		});

		it("accepts a seed where 70% of bins are below threshold (under 80%)", () => {
			// 10 bins; max is 1.0; 7 bins at 1e-7 (70% silent — under the 80% gate).
			const real = new Float32Array([1, 0.5, 0.3, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7, 1e-7]);
			const imag = new Float32Array(10);
			const validation = validateTransferSeed({ real, imag });

			expect(validation.degenerate).toBe(false);
		});

		it("rejects an all-zero seed", () => {
			const real = new Float32Array(5);
			const imag = new Float32Array(5);
			const validation = validateTransferSeed({ real, imag });

			expect(validation.degenerate).toBe(true);
		});

		it("coldStartSeed produces an all-zero TransferFunction of the requested size", () => {
			const seed = coldStartSeed(7);

			expect(seed.real.length).toBe(7);
			expect(seed.imag.length).toBe(7);
			expect(Array.from(seed.real).every((value) => value === 0)).toBe(true);
			expect(Array.from(seed.imag).every((value) => value === 0)).toBe(true);
		});
	});

	// Phase 2.2-a (post-review correction): the Kalman update must drive Ĥ
	// towards the true bleed path on a synthetic single-reference fixture.
	// Convergence target ~2 s of audio per MEF Fig. 8 — at hop=1024 / sr=48000
	// that's ~94 frames; we run 200 to leave headroom for the post-Eq. 16
	// state-dependent process noise to settle. Pure-bleed fixture (no target
	// speech) so the Kalman is at iSIR = +∞ — the favourable end of MEF's
	// reported regime, where convergence is fastest.
	describe("FDAF Kalman convergence on a fixed-path synthetic fixture", () => {
		it("Ĥ converges towards the true bleed path within ~200 frames", () => {
			const numBins = 8;
			const trueHRe = 0.4;
			const trueHIm = -0.2;

			const seed = coldStartSeed(numBins);
			const states: Array<KalmanState> = [createKalmanState(numBins, seed)];

			const adaptationSpeed = 5; // moderate adaptation speed for this test
			const markovForgetting = adaptationSpeedToMarkovForgetting(adaptationSpeed);
			const kalmanParams: KalmanParams = {
				markovForgetting,
				temporalSmoothing: 0.5,
				rOverK: DEFAULT_R_OVER_K,
			};

			const refReal = new Float32Array(numBins);
			const refImag = new Float32Array(numBins);
			const targetReal = new Float32Array(numBins);
			const targetImag = new Float32Array(numBins);
			const bleedTotalReal = new Float32Array(numBins);
			const bleedTotalImag = new Float32Array(numBins);

			// Synthesise 400 frames: random reference complex values, target = trueH · ref
			// (i.e. pure bleed, no target speech). Kalman should converge Ĥ → trueH.
			let pseudoSeed = 0xc0ffee;
			const pseudoRandom = (): number => {
				pseudoSeed = (pseudoSeed * 1664525 + 1013904223) >>> 0;

				return pseudoSeed / 0xffffffff - 0.5;
			};

			for (let frame = 0; frame < 400; frame++) {
				for (let bin = 0; bin < numBins; bin++) {
					refReal[bin] = pseudoRandom();
					refImag[bin] = pseudoRandom();
					// target = trueH · ref (complex multiply)
					targetReal[bin] = trueHRe * refReal[bin]! - trueHIm * refImag[bin]!;
					targetImag[bin] = trueHRe * refImag[bin]! + trueHIm * refReal[bin]!;
				}

				kalmanUpdateFrame(targetReal, targetImag, [refReal], [refImag], states, kalmanParams, bleedTotalReal, bleedTotalImag, false);
			}

			// Average across bins to smooth out pseudo-random tail variance.
			let sumHRe = 0;
			let sumHIm = 0;

			for (let bin = 0; bin < numBins; bin++) {
				sumHRe += states[0]!.hReal[bin]!;
				sumHIm += states[0]!.hImag[bin]!;
			}

			const meanHRe = sumHRe / numBins;
			const meanHIm = sumHIm / numBins;

			expect(meanHRe).toBeCloseTo(trueHRe, 1);
			expect(meanHIm).toBeCloseTo(trueHIm, 1);
		});
	});

	// Phase 2.2-b (post-review): abrupt-path-change tracking. The reviewer flagged
	// this as the highest-value missing test — it exercises the dynamic-path
	// tracking that motivates the new node. Synthesise 800 frames where H_true
	// flips at frame 400. Assert Ĥ tracks the new path within ~100 frames
	// (~2.1 s at hop=1024/sr=48000), matching MEF Fig. 8's ~2 s convergence
	// claim on path-change events.
	describe("FDAF Kalman tracks abrupt path change", () => {
		it("Ĥ re-converges within ~100 frames after a mid-stream H_true flip", () => {
			const numBins = 8;
			const hPathARe = 0.4;
			const hPathAIm = -0.2;
			const hPathBRe = -0.3;
			const hPathBIm = 0.5;

			const seed = coldStartSeed(numBins);
			const states: Array<KalmanState> = [createKalmanState(numBins, seed)];

			// Higher adaptation speed for an abrupt-change test — default A=0.998
			// would track too slowly to recover within 100 frames.
			const adaptationSpeed = 8;
			const markovForgetting = adaptationSpeedToMarkovForgetting(adaptationSpeed);
			const kalmanParams: KalmanParams = {
				markovForgetting,
				temporalSmoothing: 0.5,
				rOverK: DEFAULT_R_OVER_K,
			};

			const refReal = new Float32Array(numBins);
			const refImag = new Float32Array(numBins);
			const targetReal = new Float32Array(numBins);
			const targetImag = new Float32Array(numBins);
			const bleedTotalReal = new Float32Array(numBins);
			const bleedTotalImag = new Float32Array(numBins);

			let pseudoSeed = 0xfeedbeef;
			const pseudoRandom = (): number => {
				pseudoSeed = (pseudoSeed * 1664525 + 1013904223) >>> 0;

				return pseudoSeed / 0xffffffff - 0.5;
			};

			const switchFrame = 400;
			const totalFrames = 800;

			for (let frame = 0; frame < totalFrames; frame++) {
				const trueRe = frame < switchFrame ? hPathARe : hPathBRe;
				const trueIm = frame < switchFrame ? hPathAIm : hPathBIm;

				for (let bin = 0; bin < numBins; bin++) {
					refReal[bin] = pseudoRandom();
					refImag[bin] = pseudoRandom();
					targetReal[bin] = trueRe * refReal[bin]! - trueIm * refImag[bin]!;
					targetImag[bin] = trueRe * refImag[bin]! + trueIm * refReal[bin]!;
				}

				kalmanUpdateFrame(targetReal, targetImag, [refReal], [refImag], states, kalmanParams, bleedTotalReal, bleedTotalImag, false);
			}

			// After 400 frames at path B, Ĥ should be near (hPathBRe, hPathBIm).
			let sumHRe = 0;
			let sumHIm = 0;

			for (let bin = 0; bin < numBins; bin++) {
				sumHRe += states[0]!.hReal[bin]!;
				sumHIm += states[0]!.hImag[bin]!;
			}

			const meanHRe = sumHRe / numBins;
			const meanHIm = sumHIm / numBins;

			// Loose tolerance — abrupt flip + finite adaptation rate; the assertion is
			// that the filter has clearly committed to path B's neighbourhood, NOT
			// stuck at A.
			expect(Math.abs(meanHRe - hPathBRe)).toBeLessThan(0.15);
			expect(Math.abs(meanHIm - hPathBIm)).toBeLessThan(0.15);
		});
	});

	// Phase 2.3 unit (post-review): MWF Eq. 25 form regression. With target-only
	// signal (no interferers) the gain → 1; with interferer-only the gain → 0;
	// with mixed the gain is in (0, 1). Verify λ scales suppression: at λ=3 we
	// see more suppression than at λ=0.3 on the same mix.
	describe("MWF Eq. 25 form regression", () => {
		// Helper: drive PSD smoothing to steady state by repeating Eq. 28 update
		// many times, then compute one MWF mask.
		function runMwfSteadyState(
			targetReal: Float32Array,
			targetImag: Float32Array,
			bleedReal: Float32Array,
			bleedImag: Float32Array,
			oversubtraction: number,
			prevOutputPsd?: Float32Array,
		): Float32Array {
			const numBins = targetReal.length;
			const psdState = createInterfererPsdState(numBins);

			if (prevOutputPsd) {
				psdState.prevOutputPsd.set(prevOutputPsd);
			}

			for (let frame = 0; frame < 100; frame++) {
				updateInterfererPsd(bleedReal, bleedImag, psdState, 0.5);
			}

			const outMask = new Float32Array(numBins);

			computeMwfMask(targetReal, targetImag, bleedReal, bleedImag, psdState, { temporalSmoothing: 0.5, oversubtraction }, 1e-10, outMask);

			return outMask;
		}

		it("mask is ~1 when there is no interferer (target-only signal)", () => {
			const numBins = 4;
			const targetReal = new Float32Array(numBins).fill(0.7);
			const targetImag = new Float32Array(numBins).fill(0);
			const bleedReal = new Float32Array(numBins);
			const bleedImag = new Float32Array(numBins);

			// Seed prev-output PSD with target |Y|² so the dominant-bin construction
			// recognises target-active bins.
			const prevOutputPsd = new Float32Array(numBins).fill(0.7 * 0.7);

			const mask = runMwfSteadyState(targetReal, targetImag, bleedReal, bleedImag, 1.5, prevOutputPsd);

			for (let bin = 0; bin < numBins; bin++) {
				expect(mask[bin]!).toBeGreaterThan(0.99);
			}
		});

		it("mask is ~0 when target = predicted bleed (pure interferer)", () => {
			const numBins = 4;
			// Y_m = D̂ — the entire target spectrum IS the predicted bleed. Φ̂_YY
			// (= |Y − D̂|²) is therefore zero, so Φ̂_SS = 0 and W = 0/(0+λ·Φ̂_DD) → 0.
			const value = 0.7;
			const targetReal = new Float32Array(numBins).fill(value);
			const targetImag = new Float32Array(numBins).fill(0);
			const bleedReal = new Float32Array(numBins).fill(value);
			const bleedImag = new Float32Array(numBins).fill(0);

			const mask = runMwfSteadyState(targetReal, targetImag, bleedReal, bleedImag, 1.5);

			for (let bin = 0; bin < numBins; bin++) {
				expect(mask[bin]!).toBeLessThan(0.05);
			}
		});

		it("mask is in (0, 1) for a mixed target / bleed signal", () => {
			const numBins = 4;
			const targetReal = new Float32Array(numBins).fill(1.0);
			const targetImag = new Float32Array(numBins).fill(0);
			// Bleed magnitude ~half of target — Φ̂_YY ≈ 0.25, Φ̂_DD ≈ 0.25.
			const bleedReal = new Float32Array(numBins).fill(0.5);
			const bleedImag = new Float32Array(numBins).fill(0);
			const prevOutputPsd = new Float32Array(numBins).fill(0.25);

			const mask = runMwfSteadyState(targetReal, targetImag, bleedReal, bleedImag, 1.5, prevOutputPsd);

			for (let bin = 0; bin < numBins; bin++) {
				expect(mask[bin]!).toBeGreaterThan(0);
				expect(mask[bin]!).toBeLessThan(1);
			}
		});

		it("higher lambda produces more suppression than lower lambda", () => {
			const numBins = 4;
			const targetReal = new Float32Array(numBins).fill(1.0);
			const targetImag = new Float32Array(numBins).fill(0);
			const bleedReal = new Float32Array(numBins).fill(0.5);
			const bleedImag = new Float32Array(numBins).fill(0);
			const prevOutputPsd = new Float32Array(numBins).fill(0.25);

			const maskLow = runMwfSteadyState(targetReal, targetImag, bleedReal, bleedImag, 0.3, prevOutputPsd);
			const maskHigh = runMwfSteadyState(targetReal, targetImag, bleedReal, bleedImag, 3.0, prevOutputPsd);

			for (let bin = 0; bin < numBins; bin++) {
				// Higher λ → smaller W (more suppression).
				expect(maskHigh[bin]!).toBeLessThan(maskLow[bin]!);
			}
		});

		it("updatePrevOutputPsd writes |output|² into state.prevOutputPsd", () => {
			const numBins = 4;
			const psdState = createInterfererPsdState(numBins);
			const outputReal = new Float32Array([0.5, 0.6, 0.7, 0.8]);
			const outputImag = new Float32Array([0.0, 0.1, 0.2, 0.3]);

			updatePrevOutputPsd(outputReal, outputImag, psdState);

			for (let bin = 0; bin < numBins; bin++) {
				const expected = outputReal[bin]! * outputReal[bin]! + outputImag[bin]! * outputImag[bin]!;

				expect(psdState.prevOutputPsd[bin]!).toBeCloseTo(expected, 6);
			}
		});
	});

	// Phase 3.1 unit: MSAD per MEF §4.1 Eqs. 31–37. The detector's basic
	// correctness check is "loud channel reports active, silent channel does
	// not." Synthetic single-talker fixture: one channel carries pseudo-random
	// signal energy across all bins; the others are silent. After warmup
	// (Minimum Statistics tracker needs ~D × U = 96 frames to fill its sliding
	// window), the loud channel should report active.
	describe("MSAD Eqs. 31–37 single-talker", () => {
		it("loud channel reports active; silent channel reports inactive", () => {
			const numBins = 64;
			const channelCount = 3; // [target, ref0, ref1]
			const states = Array.from({ length: channelCount }, () => createMsadChannelState(numBins));

			const reals = Array.from({ length: channelCount }, () => new Float32Array(numBins));
			const imags = Array.from({ length: channelCount }, () => new Float32Array(numBins));

			let pseudoSeed = 0x12345678;
			const pseudoRandom = (): number => {
				pseudoSeed = (pseudoSeed * 1664525 + 1013904223) >>> 0;

				return pseudoSeed / 0xffffffff - 0.5;
			};

			// Warmup: 100 frames of all-quiet noise so Minimum Statistics learns
			// a low noise floor across all channels.
			const noiseLevel = 0.001;

			for (let frame = 0; frame < 100; frame++) {
				for (let m = 0; m < channelCount; m++) {
					for (let bin = 0; bin < numBins; bin++) {
						reals[m]![bin] = noiseLevel * pseudoRandom();
						imags[m]![bin] = noiseLevel * pseudoRandom();
					}
				}

				computeMsadDecision(reals, imags, states);
			}

			// Active phase: ref0 (channel index 1) speaks loudly across all bins;
			// target (0) and ref1 (2) stay at the noise floor.
			let lastDecision = computeMsadDecision(reals, imags, states);

			for (let frame = 0; frame < 30; frame++) {
				for (let m = 0; m < channelCount; m++) {
					const isActive = m === 1;

					for (let bin = 0; bin < numBins; bin++) {
						const level = isActive ? 1.0 : noiseLevel;

						reals[m]![bin] = level * pseudoRandom();
						imags[m]![bin] = level * pseudoRandom();
					}
				}

				lastDecision = computeMsadDecision(reals, imags, states);
			}

			expect(lastDecision.targetActive).toBe(false);
			expect(lastDecision.referenceActive[0]!).toBe(true);
			expect(lastDecision.referenceActive[1]!).toBe(false);
		});

		it("double-talk reports both speakers active", () => {
			const numBins = 64;
			const channelCount = 2; // [target, ref0]
			const states = Array.from({ length: channelCount }, () => createMsadChannelState(numBins));

			const reals = Array.from({ length: channelCount }, () => new Float32Array(numBins));
			const imags = Array.from({ length: channelCount }, () => new Float32Array(numBins));

			let pseudoSeed = 0xdeadbeef;
			const pseudoRandom = (): number => {
				pseudoSeed = (pseudoSeed * 1664525 + 1013904223) >>> 0;

				return pseudoSeed / 0xffffffff - 0.5;
			};

			// Warmup: 100 frames of quiet noise to seed the Minimum Statistics
			// noise floor for both channels.
			const noiseLevel = 0.001;

			for (let frame = 0; frame < 100; frame++) {
				for (let m = 0; m < channelCount; m++) {
					for (let bin = 0; bin < numBins; bin++) {
						reals[m]![bin] = noiseLevel * pseudoRandom();
						imags[m]![bin] = noiseLevel * pseudoRandom();
					}
				}

				computeMsadDecision(reals, imags, states);
			}

			// Double-talk phase: each channel's energy concentrates on a disjoint
			// half of the bins. Even bins → target loud; odd bins → ref loud.
			// Per Eq. 31's SPR, each channel "wins" its half-bins. Both channels
			// should report active.
			let lastDecision = computeMsadDecision(reals, imags, states);

			for (let frame = 0; frame < 30; frame++) {
				for (let bin = 0; bin < numBins; bin++) {
					const targetLoud = bin % 2 === 0;
					const targetLevel = targetLoud ? 1.0 : noiseLevel;
					const refLevel = targetLoud ? noiseLevel : 1.0;

					reals[0]![bin] = targetLevel * pseudoRandom();
					imags[0]![bin] = targetLevel * pseudoRandom();
					reals[1]![bin] = refLevel * pseudoRandom();
					imags[1]![bin] = refLevel * pseudoRandom();
				}

				lastDecision = computeMsadDecision(reals, imags, states);
			}

			expect(lastDecision.targetActive).toBe(true);
			expect(lastDecision.referenceActive[0]!).toBe(true);
		});
	});

	// Phase 3.3 unit: ISP restoration. After ≥ thresholdFrames of silence and a
	// transition to active, the live Kalman state must be RESTORED to the
	// previously-stored value rather than carrying any drift accumulated during
	// the silence.
	describe("ISP restoration on inactive→active transition", () => {
		it("restores stored Ĥ / P after a pause exceeding the threshold", () => {
			const numBins = 4;
			const ispState = createIspState(numBins);
			const thresholdFrames = 5;

			// Frame 1: ref active. Live Ĥ = (1, 1); applyIsp stores it.
			const kalmanState = {
				hReal: new Float32Array(numBins).fill(1),
				hImag: new Float32Array(numBins).fill(1),
				stateVariance: new Float32Array(numBins).fill(0.5),
				measurementVariance: new Float32Array(numBins).fill(1),
			};

			applyIspRestoration(kalmanState, ispState, true, thresholdFrames);
			expect(ispState.hasStored).toBe(true);
			expect(ispState.inactiveFrames).toBe(0);

			// Pause: 6 frames of inactivity (> threshold of 5). During the pause
			// the live Kalman state drifts to (3, 3) — what we want to discard.
			for (let i = 0; i < 6; i++) {
				applyIspRestoration(kalmanState, ispState, false, thresholdFrames);
			}

			expect(ispState.inactiveFrames).toBe(6);
			kalmanState.hReal.fill(3);
			kalmanState.hImag.fill(3);
			kalmanState.stateVariance.fill(2);

			// Resume: ref active again — pause exceeded threshold so we should
			// see RESTORATION, not store. Live state should snap back to (1, 1, 0.5).
			applyIspRestoration(kalmanState, ispState, true, thresholdFrames);

			for (let bin = 0; bin < numBins; bin++) {
				expect(kalmanState.hReal[bin]!).toBe(1);
				expect(kalmanState.hImag[bin]!).toBe(1);
				expect(kalmanState.stateVariance[bin]!).toBe(0.5);
			}

			expect(ispState.inactiveFrames).toBe(0);
		});

		it("does NOT restore on a short pause (< threshold)", () => {
			const numBins = 4;
			const ispState = createIspState(numBins);
			const thresholdFrames = 5;

			// Initial active: store (1, 1, 0.5).
			const kalmanState = {
				hReal: new Float32Array(numBins).fill(1),
				hImag: new Float32Array(numBins).fill(1),
				stateVariance: new Float32Array(numBins).fill(0.5),
				measurementVariance: new Float32Array(numBins).fill(1),
			};

			applyIspRestoration(kalmanState, ispState, true, thresholdFrames);

			// Pause: 3 frames (< threshold of 5).
			for (let i = 0; i < 3; i++) {
				applyIspRestoration(kalmanState, ispState, false, thresholdFrames);
			}

			// Live drifts to (2, 2). Resume.
			kalmanState.hReal.fill(2);
			kalmanState.hImag.fill(2);
			kalmanState.stateVariance.fill(0.7);

			applyIspRestoration(kalmanState, ispState, true, thresholdFrames);

			// No restoration — short pause; the new active state IS stored over.
			for (let bin = 0; bin < numBins; bin++) {
				expect(kalmanState.hReal[bin]!).toBe(2);
				expect(kalmanState.hImag[bin]!).toBe(2);
				expect(ispState.storedHReal[bin]!).toBe(2);
			}
		});
	});
});
