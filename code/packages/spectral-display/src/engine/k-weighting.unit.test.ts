import { describe, expect, it } from "vitest";
import {
  computeKWeightingCoefficients,
  createBiquadState,
  processBiquad,
  type BiquadCoefficients,
  type BiquadState,
} from "./k-weighting";

function processChain(
  sample: number,
  stage1: BiquadCoefficients,
  state1: BiquadState,
  stage2: BiquadCoefficients,
  state2: BiquadState,
): number {
  return processBiquad(processBiquad(sample, stage1, state1), stage2, state2);
}

function measureFrequencyResponse(
  sampleRate: number,
  frequency: number,
  stage1: BiquadCoefficients,
  stage2: BiquadCoefficients,
): number {
  const state1 = createBiquadState();
  const state2 = createBiquadState();

  const settleSamples = Math.ceil(sampleRate * 0.5);
  const measureSamples = Math.ceil(sampleRate * 0.1);

  for (let si = 0; si < settleSamples; si++) {
    const sample = Math.sin((2 * Math.PI * frequency * si) / sampleRate);
    processChain(sample, stage1, state1, stage2, state2);
  }

  let peakOutput = 0;

  for (let si = 0; si < measureSamples; si++) {
    const tt = settleSamples + si;
    const sample = Math.sin((2 * Math.PI * frequency * tt) / sampleRate);
    const output = processChain(sample, stage1, state1, stage2, state2);
    peakOutput = Math.max(peakOutput, Math.abs(output));
  }

  return 20 * Math.log10(peakOutput);
}

describe("computeKWeightingCoefficients", () => {
  it("48kHz stage 1 coefficients match BS.1770-4 within bilinear tolerance", () => {
    const { stage1 } = computeKWeightingCoefficients(48000);

    expect(stage1.b0).toBeCloseTo(1.53512485958697, 2);
    expect(stage1.b1).toBeCloseTo(-2.69169618940638, 2);
    expect(stage1.b2).toBeCloseTo(1.19839281085285, 2);
    expect(stage1.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(stage1.a2).toBeCloseTo(0.73248077421585, 6);
  });

  it("48kHz stage 2 denominator matches BS.1770-4 published values", () => {
    const { stage2 } = computeKWeightingCoefficients(48000);

    expect(stage2.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(stage2.a2).toBeCloseTo(0.99007225036621, 6);
    expect(stage2.b1 / stage2.b0).toBeCloseTo(-2, 6);
    expect(stage2.b2 / stage2.b0).toBeCloseTo(1, 6);
  });

  it("44.1kHz produces expected frequency response shape", () => {
    const { stage1, stage2 } = computeKWeightingCoefficients(44100);

    const at100Hz = measureFrequencyResponse(44100, 100, stage1, stage2);
    const at1kHz = measureFrequencyResponse(44100, 1000, stage1, stage2);
    const at10kHz = measureFrequencyResponse(44100, 10000, stage1, stage2);

    expect(Math.abs(at1kHz)).toBeLessThan(1.0);
    expect(at100Hz).toBeLessThan(at1kHz);
    expect(at10kHz).toBeGreaterThan(at1kHz);
  });

  it("1kHz sine at 0dBFS through K-weighting passes near unity", () => {
    const sampleRate = 48000;
    const { stage1, stage2 } = computeKWeightingCoefficients(sampleRate);

    const responseDb = measureFrequencyResponse(
      sampleRate,
      1000,
      stage1,
      stage2,
    );

    expect(Math.abs(responseDb)).toBeLessThan(1.0);
  });
});
