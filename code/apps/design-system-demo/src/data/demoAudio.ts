const SAMPLE_RATE = 44100;
const DURATION = 30;
const TIME_FRAMES = 800;
const FREQ_BINS = 256;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * DURATION) / TIME_FRAMES;

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + seed * 78.233) * 43758.5453;

  return x - Math.floor(x);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const tx = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));

  return tx * tx * (3 - 2 * tx);
}

function generateVoiceActivity(): ReadonlyArray<number> {
  const activity = new Array<number>(TIME_FRAMES);

  for (let ti = 0; ti < TIME_FRAMES; ti++) {
    const phrase1 = smoothstep(0.02, 0.08, ti / TIME_FRAMES) * smoothstep(0.35, 0.28, ti / TIME_FRAMES);
    const phrase2 = smoothstep(0.38, 0.42, ti / TIME_FRAMES) * smoothstep(0.62, 0.58, ti / TIME_FRAMES);
    const phrase3 = smoothstep(0.66, 0.70, ti / TIME_FRAMES) * smoothstep(0.92, 0.88, ti / TIME_FRAMES);

    const microPause = 0.5 + 0.5 * Math.sin(ti * 0.3 + seededRandom(ti * 7) * 2);
    const syllable = 0.4 + 0.6 * Math.pow(Math.abs(Math.sin(ti * 0.15 + seededRandom(ti * 3) * 1.5)), 0.5);

    activity[ti] = Math.max(phrase1, phrase2, phrase3) * microPause * syllable;
  }

  return activity;
}

function generateSpectrogram(): ReadonlyArray<ReadonlyArray<number>> {
  const voiceActivity = generateVoiceActivity();
  const data = new Array<Array<number>>(TIME_FRAMES);

  for (let ti = 0; ti < TIME_FRAMES; ti++) {
    const frame = new Array<number>(FREQ_BINS);
    const va = voiceActivity[ti] ?? 0;

    for (let fi = 0; fi < FREQ_BINS; fi++) {
      const freqHz = 20 * Math.pow(1000, fi / FREQ_BINS);
      let value = 0.05 + 0.03 * seededRandom(ti * FREQ_BINS + fi);

      if (va > 0.1) {
        const fundamental = 120 + 40 * Math.sin(ti * 0.05);
        const harmonics = [1, 2, 3, 4, 5, 6, 7, 8];

        for (const hn of harmonics) {
          const hFreq = fundamental * hn;
          const dist = Math.abs(freqHz - hFreq) / (hFreq * 0.08);

          if (dist < 3) {
            const harmStr = va * (1.2 / Math.pow(hn, 0.6)) * Math.exp(-dist * dist * 0.5);

            value += harmStr;
          }
        }

        if (freqHz > 4000 && freqHz < 8000) {
          const sibilance = va * 0.25 * seededRandom(ti * 17 + fi * 3);
          const sibilanceGate = seededRandom(ti * 23) > 0.6 ? 1 : 0;

          value += sibilance * sibilanceGate;
        }
      }

      const plosiveTimes = [120, 340, 520, 690];

      for (const pt of plosiveTimes) {
        const dist = Math.abs(ti - pt);

        if (dist < 6) {
          value += 0.5 * Math.exp(-dist * 0.5) * (0.5 + 0.5 * seededRandom(fi * 11 + pt));
        }
      }

      frame[fi] = Math.max(0, Math.min(1, value));
    }

    data[ti] = frame;
  }

  return data;
}

import type { AudioDisplayData, WaveformFrame, LoudnessData } from "@engineering/design-system";

function generateWaveform(): ReadonlyArray<ReadonlyArray<WaveformFrame>> {
  const voiceActivity = generateVoiceActivity();
  const channels: Array<Array<WaveformFrame>> = [];

  for (let ch = 0; ch < 2; ch++) {
    const channelData = new Array<WaveformFrame>(TIME_FRAMES);

    for (let ti = 0; ti < TIME_FRAMES; ti++) {
      const va = voiceActivity[ti] ?? 0;
      const noise = 0.02 + 0.01 * seededRandom(ti * 100 + ch * 50);
      const amplitude = va * 0.8 + noise;
      const asymmetry = 0.05 * seededRandom(ti * 200 + ch * 70);
      const variation = 0.1 * seededRandom(ti * 300 + ch * 90);

      const plosiveTimes = [120, 340, 520, 690];
      let plosiveBoost = 0;

      for (const pt of plosiveTimes) {
        const dist = Math.abs(ti - pt);

        if (dist < 4) plosiveBoost += 0.3 * Math.exp(-dist * 0.7);
      }

      const total = Math.min(1, amplitude + plosiveBoost);

      channelData[ti] = {
        min: -(total + asymmetry + variation * seededRandom(ti * 400 + ch)),
        max: total - asymmetry + variation * seededRandom(ti * 500 + ch),
      };
    }

    channels.push(channelData);
  }

  return channels;
}

function generateLoudness(): LoudnessData {
  const voiceActivity = generateVoiceActivity();
  const lufs = new Array<number>(TIME_FRAMES);
  const rms = new Array<number>(TIME_FRAMES);
  const peak = new Array<number>(TIME_FRAMES);

  for (let ti = 0; ti < TIME_FRAMES; ti++) {
    const va = voiceActivity[ti] ?? 0;
    const baseEnergy = va * 30;

    const rmsVal = -40 + baseEnergy + 2 * seededRandom(ti * 600);

    rms[ti] = Math.max(-40, Math.min(-8, rmsVal));

    peak[ti] = Math.max(-40, Math.min(-6, rmsVal + 3 + 2 * seededRandom(ti * 700)));
  }

  for (let ti = 0; ti < TIME_FRAMES; ti++) {
    let sum = 0;
    let count = 0;

    for (let ki = Math.max(0, ti - 12); ki <= Math.min(TIME_FRAMES - 1, ti + 12); ki++) {
      const wt = 1 - Math.abs(ki - ti) / 13;

      sum += (rms[ki] ?? -40) * wt;
      count += wt;
    }

    lufs[ti] = count > 0 ? sum / count - 2 : -40;
  }

  return { lufs, rms, peak };
}

let cached: AudioDisplayData | null = null;

export function getDemoAudio(): AudioDisplayData {
  if (cached) return cached;
  cached = {
    spectrogram: generateSpectrogram(),
    waveform: generateWaveform(),
    loudness: generateLoudness(),
    duration: DURATION,
    sampleRate: SAMPLE_RATE,
    timeFrames: TIME_FRAMES,
    freqBins: FREQ_BINS,
    samplesPerFrame: SAMPLES_PER_FRAME,
  };

  return cached;
}

export type { AudioDisplayData, WaveformFrame, LoudnessData };
