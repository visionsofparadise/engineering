import {
  computeKWeightingCoefficients,
  createBiquadState,
  type BiquadState,
  type KWeightingCoefficients,
} from "./k-weighting";
import type { SpectralMetadata } from "./runPipeline";
import { createTruePeakState, truePeakMaxAbs, type TruePeakState } from "./true-peak";

interface ScanState {
  pointIndex: number;
  samplesInCurrentPoint: number;
  pointMin: number;
  pointMax: number;
  pointSumSq: number;
  pointPeak: number;
  kWeightedPointSum: number;
  overallPeakAbs: number;
  overallSumSquares: number;
  totalSampleValues: number;
  truePeakAbs: number;
  biquadStates: Array<{ stage1: BiquadState; stage2: BiquadState }>;
  truePeakStates: Array<TruePeakState>;
}

export interface ScanContext {
  channelCount: number;
  channelWeights: Float32Array;
  samplesPerPoint: number;
  computeLoudness: boolean;
  computeTruePeak: boolean;
  kWeightingCoefficients: KWeightingCoefficients;
  state: ScanState;
  monoBuffer: Float32Array;
  kwBuffer: Float32Array;
  waveformBuffer: Float32Array;
  rmsEnvelope: Float32Array;
  peakEnvelope: Float32Array;
  kWeightedMeanSquare: Float32Array;
}

export function createScanContext(
  metadata: SpectralMetadata,
  pointCount: number,
  samplesPerPoint: number,
  chunkSize: number,
  computeLoudness = true,
  computeTruePeak = true,
): ScanContext {
  const { channelCount, sampleRate, channelWeights: weights } = metadata;
  const biquadStates: Array<{ stage1: BiquadState; stage2: BiquadState }> = [];
  const truePeakStates: Array<TruePeakState> = [];

  for (let ch = 0; ch < channelCount; ch++) {
    biquadStates.push({
      stage1: createBiquadState(),
      stage2: createBiquadState(),
    });
    truePeakStates.push(createTruePeakState());
  }

  const channelWeights = new Float32Array(channelCount);

  if (weights) {
    for (let ch = 0; ch < channelCount; ch++) {
      channelWeights[ch] = weights[ch] ?? 1;
    }
  } else {
    channelWeights.fill(1);
  }

  return {
    channelCount,
    channelWeights,
    samplesPerPoint,
    computeLoudness,
    computeTruePeak,
    kWeightingCoefficients: computeKWeightingCoefficients(sampleRate),
    state: {
      pointIndex: 0,
      samplesInCurrentPoint: 0,
      pointMin: Infinity,
      pointMax: -Infinity,
      pointSumSq: 0,
      pointPeak: 0,
      kWeightedPointSum: 0,
      overallPeakAbs: 0,
      overallSumSquares: 0,
      totalSampleValues: 0,
      truePeakAbs: 0,
      biquadStates,
      truePeakStates,
    },
    monoBuffer: new Float32Array(chunkSize),
    kwBuffer: new Float32Array(chunkSize),
    waveformBuffer: new Float32Array(pointCount * 2),
    rmsEnvelope: new Float32Array(pointCount),
    peakEnvelope: new Float32Array(pointCount),
    kWeightedMeanSquare: new Float32Array(pointCount),
  };
}

export function finalizeScan(
  context: ScanContext,
): { overallPeak: number; overallRms: number; truePeak: number } {
  const { state } = context;

  return {
    overallPeak: state.overallPeakAbs,
    overallRms:
      state.totalSampleValues > 0
        ? Math.sqrt(state.overallSumSquares / state.totalSampleValues)
        : 0,
    truePeak: state.truePeakAbs,
  };
}

export function scanSamples(
  channelBuffers: ReadonlyArray<Float32Array>,
  samplesPerChannel: number,
  context: ScanContext,
  timing?: { channelPass: number; reduction: number },
): void {
  const { channelCount, channelWeights, samplesPerPoint, computeLoudness, computeTruePeak, kWeightingCoefficients, state, monoBuffer, kwBuffer, waveformBuffer, rmsEnvelope, peakEnvelope, kWeightedMeanSquare } = context;
  const invChannels = 1 / channelCount;
  const { stage1: s1Coeffs, stage2: s2Coeffs } = kWeightingCoefficients;
  const lastChannel = channelCount - 1;
  const pointCount = Math.ceil(waveformBuffer.length / 2);

  monoBuffer.fill(0, 0, samplesPerChannel);
  kwBuffer.fill(0, 0, samplesPerChannel);

  let { pointIndex, samplesInCurrentPoint } = state;
  let { pointMin, pointMax, pointSumSq, pointPeak, kWeightedPointSum } = state;
  let { overallPeakAbs, overallSumSquares, totalSampleValues, truePeakAbs } = state;

  const t0 = timing ? performance.now() : 0;

  const s1b0 = s1Coeffs.b0;
  const s1b1 = s1Coeffs.b1;
  const s1b2 = s1Coeffs.b2;
  const s1a1 = s1Coeffs.a1;
  const s1a2 = s1Coeffs.a2;
  const s2b0 = s2Coeffs.b0;
  const s2b1 = s2Coeffs.b1;
  const s2b2 = s2Coeffs.b2;
  const s2a1 = s2Coeffs.a1;
  const s2a2 = s2Coeffs.a2;

  for (let ch = 0; ch < channelCount; ch++) {
    const channelData = channelBuffers[ch]!;
    const biquad = state.biquadStates[ch]!;
    const chWeight = channelWeights[ch]!;
    const tpState = state.truePeakStates[ch]!;

    let s1x1 = biquad.stage1.x1;
    let s1x2 = biquad.stage1.x2;
    let s1y1 = biquad.stage1.y1;
    let s1y2 = biquad.stage1.y2;
    let s2x1 = biquad.stage2.x1;
    let s2x2 = biquad.stage2.x2;
    let s2y1 = biquad.stage2.y1;
    let s2y2 = biquad.stage2.y2;

    if (ch < lastChannel) {
      for (let si = 0; si < samplesPerChannel; si++) {
        const sample = channelData[si]!;

        monoBuffer[si] = monoBuffer[si]! + sample;

        if (computeLoudness) {
          const s1out = s1b0 * sample + s1b1 * s1x1 + s1b2 * s1x2 - s1a1 * s1y1 - s1a2 * s1y2;

          s1x2 = s1x1; s1x1 = sample; s1y2 = s1y1; s1y1 = s1out;

          const kw = s2b0 * s1out + s2b1 * s2x1 + s2b2 * s2x2 - s2a1 * s2y1 - s2a2 * s2y2;

          s2x2 = s2x1; s2x1 = s1out; s2y2 = s2y1; s2y1 = kw;

          kwBuffer[si] = kwBuffer[si]! + chWeight * kw * kw;
        }

        if (computeTruePeak) {
          const tp = truePeakMaxAbs(sample, tpState);

          if (tp > truePeakAbs) truePeakAbs = tp;
        }
      }
    } else {
      if (timing) {
        timing.channelPass += performance.now() - t0;
      }

      const t1 = timing ? performance.now() : 0;

      for (let si = 0; si < samplesPerChannel; si++) {
        const sample = channelData[si]!;
        const mono = (monoBuffer[si]! + sample) * invChannels;

        monoBuffer[si] = mono;

        if (computeLoudness) {
          const s1out = s1b0 * sample + s1b1 * s1x1 + s1b2 * s1x2 - s1a1 * s1y1 - s1a2 * s1y2;

          s1x2 = s1x1; s1x1 = sample; s1y2 = s1y1; s1y1 = s1out;

          const kw = s2b0 * s1out + s2b1 * s2x1 + s2b2 * s2x2 - s2a1 * s2y1 - s2a2 * s2y2;

          s2x2 = s2x1; s2x1 = s1out; s2y2 = s2y1; s2y1 = kw;

          kWeightedPointSum += kwBuffer[si]! + chWeight * kw * kw;
        }

        if (computeTruePeak) {
          const tp = truePeakMaxAbs(sample, tpState);

          if (tp > truePeakAbs) truePeakAbs = tp;
        }

        const sq = mono * mono;
        const abs = mono < 0 ? -mono : mono;

        if (mono < pointMin) pointMin = mono;
        if (mono > pointMax) pointMax = mono;
        pointSumSq += sq;
        if (abs > pointPeak) pointPeak = abs;
        if (abs > overallPeakAbs) overallPeakAbs = abs;
        overallSumSquares += sq;
        samplesInCurrentPoint++;
        totalSampleValues++;

        if (samplesInCurrentPoint >= samplesPerPoint && pointIndex < pointCount) {
          const wo = pointIndex * 2;
          const invSamples = 1 / samplesInCurrentPoint;

          waveformBuffer[wo] = pointMin;
          waveformBuffer[wo + 1] = pointMax;
          rmsEnvelope[pointIndex] = Math.sqrt(pointSumSq * invSamples);
          peakEnvelope[pointIndex] = pointPeak;
          kWeightedMeanSquare[pointIndex] = kWeightedPointSum * invSamples;

          pointMin = Infinity;
          pointMax = -Infinity;
          pointSumSq = 0;
          pointPeak = 0;
          kWeightedPointSum = 0;
          samplesInCurrentPoint = 0;
          pointIndex++;
        }
      }

      if (timing) timing.reduction += performance.now() - t1;
    }

    biquad.stage1.x1 = s1x1;
    biquad.stage1.x2 = s1x2;
    biquad.stage1.y1 = s1y1;
    biquad.stage1.y2 = s1y2;
    biquad.stage2.x1 = s2x1;
    biquad.stage2.x2 = s2x2;
    biquad.stage2.y1 = s2y1;
    biquad.stage2.y2 = s2y2;
  }

  state.overallPeakAbs = overallPeakAbs;
  state.overallSumSquares = overallSumSquares;
  state.totalSampleValues = totalSampleValues;
  state.truePeakAbs = truePeakAbs;
  state.pointIndex = pointIndex;
  state.samplesInCurrentPoint = samplesInCurrentPoint;
  state.pointMin = pointMin;
  state.pointMax = pointMax;
  state.pointSumSq = pointSumSq;
  state.pointPeak = pointPeak;
  state.kWeightedPointSum = kWeightedPointSum;
}
