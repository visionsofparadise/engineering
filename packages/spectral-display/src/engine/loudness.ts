import type { ScanContext } from "./sample-scan";

export interface LoudnessData {
  rmsEnvelope: Float32Array;
  peakEnvelope: Float32Array;
  momentaryLufs: Float32Array;
  shortTermLufs: Float32Array;
  integratedLufs: number;
  peakDb: number;
  truePeak?: number;
  truePeakDb?: number;
  rmsDb: number;
  crestFactor: number;
  pointCount: number;
}

const LUFS_OFFSET = -0.691;
const ABSOLUTE_GATE_THRESHOLD = -70;
const RELATIVE_GATE_OFFSET = -10;

export const WAVEFORM_POINTS_PER_SECOND = 500;
const MOMENTARY_WINDOW_MS = 400;
const SHORT_TERM_WINDOW_MS = 3000;
const BLOCK_DURATION_MS = 400;
const BLOCK_STEP_MS = 100;

export function meanSquareToLufs(meanSquare: number): number {
  if (meanSquare <= 0) return -Infinity;

  return LUFS_OFFSET + 10 * Math.log10(meanSquare);
}

export function computeMomentaryLufs(
  kWeightedMeanSquare: Float32Array,
  windowPoints: number,
): Float32Array {
  const pointCount = kWeightedMeanSquare.length;
  const result = new Float32Array(pointCount);

  let runningSum = 0;

  for (let pt = 0; pt < pointCount; pt++) {
    runningSum += kWeightedMeanSquare[pt]!;

    if (pt >= windowPoints) {
      runningSum -= kWeightedMeanSquare[pt - windowPoints]!;
    }

    if (pt + 1 < windowPoints) {
      result[pt] = -Infinity;
    } else {
      result[pt] = meanSquareToLufs(runningSum / windowPoints);
    }
  }

  return result;
}

export function computeIntegratedLufs(blockLoudness: Float32Array): number {
  const absoluteSurvivors: Array<number> = [];

  for (let bi = 0; bi < blockLoudness.length; bi++) {
    const lufs = blockLoudness[bi]!;

    if (lufs > ABSOLUTE_GATE_THRESHOLD) {
      absoluteSurvivors.push(lufs);
    }
  }

  if (absoluteSurvivors.length === 0) return -Infinity;

  let absoluteMeanPower = 0;

  for (const lufs of absoluteSurvivors) {
    absoluteMeanPower += Math.pow(10, (lufs - LUFS_OFFSET) / 10);
  }

  absoluteMeanPower /= absoluteSurvivors.length;
  const relativeThreshold = meanSquareToLufs(absoluteMeanPower) + RELATIVE_GATE_OFFSET;

  let relativeMeanPower = 0;
  let relativeCount = 0;

  for (const lufs of absoluteSurvivors) {
    if (lufs > relativeThreshold) {
      relativeMeanPower += Math.pow(10, (lufs - LUFS_OFFSET) / 10);
      relativeCount++;
    }
  }

  if (relativeCount === 0) return -Infinity;

  relativeMeanPower /= relativeCount;

  return meanSquareToLufs(relativeMeanPower);
}

export function computeRunningIntegratedLufs(
  blockLoudness: Float32Array,
): Float32Array {
  const result = new Float32Array(blockLoudness.length);
  const absoluteSurvivors: Array<{ lufs: number; power: number }> = [];
  let absolutePowerSum = 0;

  for (let bi = 0; bi < blockLoudness.length; bi++) {
    const lufs = blockLoudness[bi]!;

    if (lufs > ABSOLUTE_GATE_THRESHOLD) {
      const power = Math.pow(10, (lufs - LUFS_OFFSET) / 10);

      absoluteSurvivors.push({ lufs, power });
      absolutePowerSum += power;
    }

    if (absoluteSurvivors.length === 0) {
      result[bi] = -Infinity;
      continue;
    }

    const absoluteMeanPower = absolutePowerSum / absoluteSurvivors.length;
    const relativeThreshold =
      meanSquareToLufs(absoluteMeanPower) + RELATIVE_GATE_OFFSET;

    let relativePowerSum = 0;
    let relativeCount = 0;

    for (const survivor of absoluteSurvivors) {
      if (survivor.lufs > relativeThreshold) {
        relativePowerSum += survivor.power;
        relativeCount++;
      }
    }

    result[bi] =
      relativeCount === 0
        ? -Infinity
        : meanSquareToLufs(relativePowerSum / relativeCount);
  }

  return result;
}

export function computeLoudnessData(
  scanContext: ScanContext,
  overallPeak: number,
  overallRms: number,
  truePeak?: number,
): LoudnessData {
  const { rmsEnvelope, peakEnvelope } = scanContext;
  const pointCount = scanContext.state.pointIndex;
  const kWeightedMeanSquare = scanContext.kWeightedMeanSquare.subarray(0, pointCount);
  const momentaryWindowPoints = Math.round((MOMENTARY_WINDOW_MS / 1000) * WAVEFORM_POINTS_PER_SECOND);
  const shortTermWindowPoints = Math.round((SHORT_TERM_WINDOW_MS / 1000) * WAVEFORM_POINTS_PER_SECOND);

  const momentaryLufs = computeMomentaryLufs(kWeightedMeanSquare, momentaryWindowPoints);
  const shortTermLufs = computeMomentaryLufs(kWeightedMeanSquare, shortTermWindowPoints);

  const blockPoints = Math.round((BLOCK_DURATION_MS / 1000) * WAVEFORM_POINTS_PER_SECOND);
  const stepPoints = Math.round((BLOCK_STEP_MS / 1000) * WAVEFORM_POINTS_PER_SECOND);

  const blockLoudnessValues: Array<number> = [];

  for (let start = 0; start + blockPoints <= pointCount; start += stepPoints) {
    let sum = 0;

    for (let pt = start; pt < start + blockPoints; pt++) {

      sum += kWeightedMeanSquare[pt]!;
    }

    blockLoudnessValues.push(meanSquareToLufs(sum / blockPoints));
  }

  const blockLoudness = new Float32Array(blockLoudnessValues);
  const integratedLufs = computeIntegratedLufs(blockLoudness);

  const peakDb = overallPeak > 0 ? 20 * Math.log10(overallPeak) : -Infinity;
  const truePeakDb = truePeak !== undefined && truePeak > 0 ? 20 * Math.log10(truePeak) : undefined;
  const rmsDb = overallRms > 0 ? 20 * Math.log10(overallRms) : -Infinity;
  const crestFactor = overallRms > 0 ? 20 * Math.log10(overallPeak / overallRms) : 0;

  return {
    rmsEnvelope,
    peakEnvelope,
    momentaryLufs,
    shortTermLufs,
    integratedLufs,
    peakDb,
    truePeak,
    truePeakDb,
    rmsDb,
    crestFactor,
    pointCount,
  };
}
