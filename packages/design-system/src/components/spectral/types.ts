export interface WaveformFrame {
  readonly min: number;
  readonly max: number;
}

export interface LoudnessData {
  readonly lufs: ReadonlyArray<number>;
  readonly rms: ReadonlyArray<number>;
  readonly peak: ReadonlyArray<number>;
}

export interface AudioDisplayData {
  readonly spectrogram: ReadonlyArray<ReadonlyArray<number>>;
  readonly waveform: ReadonlyArray<ReadonlyArray<WaveformFrame>>;
  readonly loudness: LoudnessData;
  readonly duration: number;
  readonly sampleRate: number;
  readonly timeFrames: number;
  readonly freqBins: number;
  readonly samplesPerFrame: number;
}

export interface AudioData {
  sampleRate: number;
  channels: number;
  totalSamples: number;
  durationMs: number;
  readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
}
