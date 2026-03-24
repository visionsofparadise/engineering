import { describe, expect, it } from "vitest";
import { createScanContext, finalizeScan, scanSamples } from "./sample-scan";

const POINTS_PER_SECOND = 500;
const CHUNK_SIZE = 131072;

function generateChannelBuffers(
  frequency: number,
  amplitude: number,
  sampleRate: number,
  durationSeconds: number,
  channels: number,
): Array<Float32Array> {
  const samplesPerChannel = Math.floor(sampleRate * durationSeconds);
  const buffers: Array<Float32Array> = [];

  for (let ch = 0; ch < channels; ch++) {
    const buffer = new Float32Array(samplesPerChannel);

    for (let si = 0; si < samplesPerChannel; si++) {
      buffer[si] =
        amplitude * Math.sin((2 * Math.PI * frequency * si) / sampleRate);
    }

    buffers.push(buffer);
  }

  return buffers;
}

function scanAll(
  channelBuffers: Array<Float32Array>,
  channels: number,
  sampleRate: number,
) {
  const samplesPerPoint = Math.round(sampleRate / POINTS_PER_SECOND);
  const samplesPerChannel = channelBuffers[0]?.length ?? 0;
  const pointCount = Math.ceil(samplesPerChannel / samplesPerPoint);

  const metadata = { sampleRate, sampleCount: samplesPerChannel, channelCount: channels };
  const context = createScanContext(metadata, pointCount, samplesPerPoint, Math.min(samplesPerChannel, CHUNK_SIZE));

  scanSamples(channelBuffers, samplesPerChannel, context);

  const { overallPeak, overallRms } = finalizeScan(context);

  return {
    monoOutput: context.monoBuffer,
    waveformBuffer: context.waveformBuffer,
    rmsEnvelope: context.rmsEnvelope,
    peakEnvelope: context.peakEnvelope,
    kWeightedMeanSquare: context.kWeightedMeanSquare,
    overallPeak,
    overallRms,
    pointCount,
  };
}

describe("scanSamples", () => {
  it("produces correct waveform min/max for a sine wave", () => {
    const sampleRate = 48000;
    const amplitude = 0.8;
    const buffers = generateChannelBuffers(440, amplitude, sampleRate, 1, 1);

    const result = scanAll(buffers, 1, sampleRate);

    expect(result.pointCount).toBe(500);
    expect(result.waveformBuffer.length).toBe(500 * 2);

    let foundNearMax = false;
    let foundNearMin = false;

    for (let pt = 0; pt < result.pointCount; pt++) {
      const min = result.waveformBuffer[pt * 2]!;
      const max = result.waveformBuffer[pt * 2 + 1]!;

      expect(min).toBeLessThanOrEqual(max);
      expect(min).toBeGreaterThanOrEqual(-amplitude - 0.001);
      expect(max).toBeLessThanOrEqual(amplitude + 0.001);

      if (max > amplitude * 0.95) foundNearMax = true;
      if (min < -amplitude * 0.95) foundNearMin = true;
    }

    expect(foundNearMax).toBe(true);
    expect(foundNearMin).toBe(true);
  });

  it("produces correct RMS for a known amplitude sine", () => {
    const sampleRate = 48000;
    const amplitude = 1.0;
    const expectedRms = amplitude / Math.sqrt(2);
    const buffers = generateChannelBuffers(1000, amplitude, sampleRate, 1, 1);

    const result = scanAll(buffers, 1, sampleRate);

    expect(result.overallRms).toBeCloseTo(expectedRms, 2);

    for (let pt = 1; pt < result.pointCount - 1; pt++) {
      const pointRms = result.rmsEnvelope[pt]!;
      expect(pointRms).toBeCloseTo(expectedRms, 1);
    }
  });

  it("produces correct overall peak", () => {
    const sampleRate = 48000;
    const amplitude = 0.5;
    const buffers = generateChannelBuffers(440, amplitude, sampleRate, 0.5, 1);

    const result = scanAll(buffers, 1, sampleRate);

    expect(result.overallPeak).toBeCloseTo(amplitude, 2);
  });

  it("handles stereo by averaging channels into mono output", () => {
    const sampleRate = 48000;
    const duration = 0.5;
    const samplesPerChannel = Math.floor(sampleRate * duration);

    const left = new Float32Array(samplesPerChannel);
    const right = new Float32Array(samplesPerChannel);

    for (let si = 0; si < samplesPerChannel; si++) {
      const phase = (2 * Math.PI * 440 * si) / sampleRate;
      left[si] = 0.5 * Math.sin(phase);
      right[si] = 0.25 * Math.sin(phase);
    }

    const result = scanAll([left, right], 2, sampleRate);
    const pointCount = result.pointCount;

    expect(result.waveformBuffer.length).toBe(pointCount * 2);
    expect(result.rmsEnvelope.length).toBe(pointCount);

    const expectedAvgAmplitude = (0.5 + 0.25) / 2;
    let maxPeak = 0;

    for (let pt = 0; pt < pointCount; pt++) {
      maxPeak = Math.max(maxPeak, result.peakEnvelope[pt]!);
    }

    expect(maxPeak).toBeCloseTo(expectedAvgAmplitude, 1);
  });

  it("produces mono output buffer", () => {
    const sampleRate = 48000;
    const duration = 0.5;
    const samplesPerChannel = Math.floor(sampleRate * duration);

    const left = new Float32Array(samplesPerChannel);
    const right = new Float32Array(samplesPerChannel);

    for (let si = 0; si < samplesPerChannel; si++) {
      left[si] = 0.6;
      right[si] = 0.4;
    }

    const result = scanAll([left, right], 2, sampleRate);

    expect(result.monoOutput[0]).toBeCloseTo(0.5, 5);
    expect(result.monoOutput[100]).toBeCloseTo(0.5, 5);
  });

  it("computes k-weighted mean square", () => {
    const sampleRate = 48000;
    const buffers = generateChannelBuffers(1000, 0.5, sampleRate, 1, 1);

    const result = scanAll(buffers, 1, sampleRate);

    expect(result.kWeightedMeanSquare.length).toBe(result.pointCount);

    let hasNonZero = false;

    for (let pt = 1; pt < result.pointCount; pt++) {
      if (result.kWeightedMeanSquare[pt]! > 0) {
        hasNonZero = true;
        break;
      }
    }

    expect(hasNonZero).toBe(true);
  });

  it("returns zero-length arrays for empty input", () => {
    const result = scanAll([new Float32Array(0)], 1, 48000);

    expect(result.pointCount).toBe(0);
    expect(result.waveformBuffer.length).toBe(0);
    expect(result.overallPeak).toBe(0);
    expect(result.overallRms).toBe(0);
  });
});
