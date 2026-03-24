import { describe, expect, it } from "vitest";
import {
  computeIntegratedLufs,
  computeMomentaryLufs,
  computeRunningIntegratedLufs,
  meanSquareToLufs,
} from "./loudness";
import {
  computeKWeightingCoefficients,
  createBiquadState,
  processBiquad,
} from "./k-weighting";

function generateKWeightedMeanSquare(
  frequency: number,
  amplitudeDbfs: number,
  sampleRate: number,
  durationSeconds: number,
  pointsPerSecond: number,
): Float32Array {
  const amplitude = Math.pow(10, amplitudeDbfs / 20);
  const totalSamples = Math.floor(sampleRate * durationSeconds);
  const samplesPerPoint = Math.round(sampleRate / pointsPerSecond);
  const pointCount = Math.ceil(totalSamples / samplesPerPoint);
  const result = new Float32Array(pointCount);

  const { stage1, stage2 } = computeKWeightingCoefficients(sampleRate);
  const state1 = createBiquadState();
  const state2 = createBiquadState();

  let pointIndex = 0;
  let kWeightedSum = 0;
  let sampleInPoint = 0;

  for (let i = 0; i < totalSamples; i++) {
    const sample = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    const kWeighted = processBiquad(processBiquad(sample, stage1, state1), stage2, state2);

    kWeightedSum += kWeighted * kWeighted;
    sampleInPoint++;

    if (sampleInPoint >= samplesPerPoint || i === totalSamples - 1) {
      if (pointIndex < pointCount) {
        result[pointIndex] = kWeightedSum / sampleInPoint;
      }

      pointIndex++;
      kWeightedSum = 0;
      sampleInPoint = 0;
    }
  }

  return result;
}

describe("meanSquareToLufs", () => {
  it("returns -Infinity for zero", () => {
    expect(meanSquareToLufs(0)).toBe(-Infinity);
  });

  it("returns -Infinity for negative", () => {
    expect(meanSquareToLufs(-1)).toBe(-Infinity);
  });
});

describe("computeIntegratedLufs", () => {
  it("1kHz sine at -23 LUFS amplitude yields integrated LUFS near -23", () => {
    const pointsPerSecond = 500;
    const kWeightedMs = generateKWeightedMeanSquare(
      1000,
      -23 / 1 + 3,
      48000,
      10,
      pointsPerSecond,
    );

    const momentaryWindowPoints = Math.round(0.4 * pointsPerSecond);
    const momentary = computeMomentaryLufs(kWeightedMs, momentaryWindowPoints);

    const blockStepPoints = Math.round(0.1 * pointsPerSecond);
    const blockWindowPoints = momentaryWindowPoints;
    const blockCount = Math.floor(
      (momentary.length - blockWindowPoints) / blockStepPoints,
    ) + 1;
    const blockLoudness = new Float32Array(Math.max(0, blockCount));

    for (let i = 0; i < blockCount; i++) {
      const blockEnd = i * blockStepPoints + blockWindowPoints - 1;

      if (blockEnd < momentary.length) {
        blockLoudness[i] = momentary[blockEnd]!;
      }
    }

    const integrated = computeIntegratedLufs(blockLoudness);

    expect(integrated).toBeGreaterThan(-25);
    expect(integrated).toBeLessThan(-21);
  });

  it("silence returns -Infinity", () => {
    const silence = new Float32Array(100).fill(-Infinity);
    const result = computeIntegratedLufs(silence);

    expect(result).toBe(-Infinity);
  });

  it("signal with silent sections gates correctly", () => {
    const pointsPerSecond = 500;
    const signalMs = generateKWeightedMeanSquare(1000, -20, 48000, 5, pointsPerSecond);
    const silenceMs = new Float32Array(5 * pointsPerSecond);

    const combined = new Float32Array(signalMs.length + silenceMs.length);
    combined.set(signalMs);
    combined.set(silenceMs, signalMs.length);

    const momentaryWindowPoints = Math.round(0.4 * pointsPerSecond);
    const momentary = computeMomentaryLufs(combined, momentaryWindowPoints);

    const blockStepPoints = Math.round(0.1 * pointsPerSecond);
    const blockWindowPoints = momentaryWindowPoints;
    const blockCount = Math.floor(
      (momentary.length - blockWindowPoints) / blockStepPoints,
    ) + 1;
    const blockLoudness = new Float32Array(Math.max(0, blockCount));

    for (let i = 0; i < blockCount; i++) {
      const blockEnd = i * blockStepPoints + blockWindowPoints - 1;

      if (blockEnd < momentary.length) {
        blockLoudness[i] = momentary[blockEnd]!;
      }
    }

    const integrated = computeIntegratedLufs(blockLoudness);

    expect(Number.isFinite(integrated)).toBe(true);
    expect(integrated).toBeGreaterThan(-40);
  });
});

describe("computeMomentaryLufs", () => {
  it("returns array of correct length", () => {
    const input = new Float32Array(100);
    const result = computeMomentaryLufs(input, 200);

    expect(result.length).toBe(100);
  });

  it("produces values within ±2dB of expected for 1kHz sine after window fills", () => {
    const sampleRate = 48000;
    const pointsPerSecond = 500;
    const windowSeconds = 0.4;
    const windowPoints = Math.round(windowSeconds * pointsPerSecond);
    const expectedLufs = -20;

    const kWeightedMs = generateKWeightedMeanSquare(
      1000,
      expectedLufs + 3,
      sampleRate,
      2,
      pointsPerSecond,
    );

    const result = computeMomentaryLufs(kWeightedMs, windowPoints);

    // Check values after window has filled (past the initial ramp-up)
    for (let i = windowPoints + 50; i < result.length; i++) {
      expect(result[i]!).toBeGreaterThan(expectedLufs - 2);
      expect(result[i]!).toBeLessThan(expectedLufs + 2);
    }
  });

  it("produces -Infinity for silence at every point", () => {
    const silence = new Float32Array(200);
    const result = computeMomentaryLufs(silence, 50);

    for (let i = 0; i < result.length; i++) {
      expect(result[i]).toBe(-Infinity);
    }
  });
});

describe("computeMomentaryLufs with larger window (short-term)", () => {
  it("returns array of correct length", () => {
    const input = new Float32Array(100);
    const result = computeMomentaryLufs(input, 1500);

    expect(result.length).toBe(100);
  });

  it("produces values within ±2dB of expected for 1kHz sine after window fills", () => {
    const sampleRate = 48000;
    const pointsPerSecond = 500;
    const windowSeconds = 3;
    const windowPoints = Math.round(windowSeconds * pointsPerSecond);
    const expectedLufs = -20;

    const kWeightedMs = generateKWeightedMeanSquare(
      1000,
      expectedLufs + 3,
      sampleRate,
      6,
      pointsPerSecond,
    );

    const result = computeMomentaryLufs(kWeightedMs, windowPoints);

    for (let i = windowPoints + 50; i < result.length; i++) {
      expect(result[i]!).toBeGreaterThan(expectedLufs - 2);
      expect(result[i]!).toBeLessThan(expectedLufs + 2);
    }
  });
});

describe("computeRunningIntegratedLufs", () => {
  it("returns array of correct length", () => {
    const input = new Float32Array(50);

    for (let i = 0; i < 50; i++) {
      input[i] = 0.001;
    }

    const result = computeRunningIntegratedLufs(input);

    expect(result.length).toBe(50);
  });

  it("final value matches computeIntegratedLufs for the same block data", () => {
    const pointsPerSecond = 500;
    const kWeightedMs = generateKWeightedMeanSquare(
      1000,
      -20,
      48000,
      5,
      pointsPerSecond,
    );

    const momentaryWindowPoints = Math.round(0.4 * pointsPerSecond);
    const momentary = computeMomentaryLufs(kWeightedMs, momentaryWindowPoints);

    const blockStepPoints = Math.round(0.1 * pointsPerSecond);
    const blockWindowPoints = momentaryWindowPoints;
    const blockCount =
      Math.floor((momentary.length - blockWindowPoints) / blockStepPoints) + 1;
    const blockLoudness = new Float32Array(Math.max(0, blockCount));

    for (let i = 0; i < blockCount; i++) {
      const blockEnd = i * blockStepPoints + blockWindowPoints - 1;

      if (blockEnd < momentary.length) {
        blockLoudness[i] = momentary[blockEnd]!;
      }
    }

    const integrated = computeIntegratedLufs(blockLoudness);
    const running = computeRunningIntegratedLufs(blockLoudness);
    const finalRunning = running[running.length - 1]!;

    expect(Math.abs(finalRunning - integrated)).toBeLessThan(0.01);
  });

  it("converges to a stable value for constant-level signal", () => {
    const pointsPerSecond = 500;
    const kWeightedMs = generateKWeightedMeanSquare(
      1000,
      -20,
      48000,
      5,
      pointsPerSecond,
    );

    const momentaryWindowPoints = Math.round(0.4 * pointsPerSecond);
    const momentary = computeMomentaryLufs(kWeightedMs, momentaryWindowPoints);

    const blockStepPoints = Math.round(0.1 * pointsPerSecond);
    const blockWindowPoints = momentaryWindowPoints;
    const blockCount =
      Math.floor((momentary.length - blockWindowPoints) / blockStepPoints) + 1;
    const blockLoudness = new Float32Array(Math.max(0, blockCount));

    for (let i = 0; i < blockCount; i++) {
      const blockEnd = i * blockStepPoints + blockWindowPoints - 1;

      if (blockEnd < momentary.length) {
        blockLoudness[i] = momentary[blockEnd]!;
      }
    }

    const running = computeRunningIntegratedLufs(blockLoudness);

    // After initial ramp, consecutive values should differ by decreasing amounts
    const lastQuarterStart = Math.floor(running.length * 0.75);

    for (let i = lastQuarterStart + 1; i < running.length; i++) {
      const diff = Math.abs(running[i]! - running[i - 1]!);

      expect(diff).toBeLessThan(1);
    }
  });
});
