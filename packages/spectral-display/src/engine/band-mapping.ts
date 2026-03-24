export type FrequencyScale = "linear" | "log" | "mel" | "erb";

interface BandMapping {
  binStart: number;
  binEnd: number;
  weightStart: number;
  weightEnd: number;
}

function freqToMel(frequency: number): number {
  return 2595 * Math.log10(1 + frequency / 700);
}

function melToFreq(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function freqToErb(frequency: number): number {
  return 21.4 * Math.log10(1 + 0.00437 * frequency);
}

function erbToFreq(erb: number): number {
  return (Math.pow(10, erb / 21.4) - 1) / 0.00437;
}

function computeScaledBandMappings(
  numBands: number,
  minFreq: number,
  maxFreq: number,
  sampleRate: number,
  fftSize: number,
  toScale: (frequency: number) => number,
  fromScale: (scaled: number) => number,
): ReadonlyArray<BandMapping> {
  const scaleMin = toScale(minFreq);
  const scaleMax = toScale(maxFreq);
  const scaleStep = (scaleMax - scaleMin) / numBands;
  const binWidth = sampleRate / fftSize;
  const numLinearBins = fftSize / 2 + 1;
  const mappings: Array<BandMapping> = [];

  for (let band = 0; band < numBands; band++) {
    const freqLow = fromScale(scaleMin + band * scaleStep);
    const freqHigh = fromScale(scaleMin + (band + 1) * scaleStep);
    const exactBinLow = freqLow / binWidth;
    const exactBinHigh = freqHigh / binWidth;
    const binStart = Math.max(0, Math.floor(exactBinLow));
    const binEnd = Math.min(numLinearBins - 1, Math.ceil(exactBinHigh));
    const weightStart = 1 - (exactBinLow - binStart);
    const weightEnd = 1 - (binEnd - exactBinHigh);

    mappings.push({
      binStart,
      binEnd: Math.max(binStart, binEnd),
      weightStart: Math.max(0, Math.min(1, weightStart)),
      weightEnd: Math.max(0, Math.min(1, weightEnd)),
    });
  }

  return mappings;
}

export function computeBandMappings(
  scale: FrequencyScale,
  numBands: number,
  sampleRate: number,
  fftSize: number,
): Float32Array {
  if (scale === "linear") {
    return new Float32Array(0);
  }

  const minFreq = 20;
  const maxFreq = sampleRate / 2;

  let mappings: ReadonlyArray<BandMapping>;

  if (scale === "log") {
    mappings = computeScaledBandMappings(
      numBands,
      minFreq,
      maxFreq,
      sampleRate,
      fftSize,
      Math.log,
      Math.exp,
    );
  } else if (scale === "mel") {
    mappings = computeScaledBandMappings(
      numBands,
      minFreq,
      maxFreq,
      sampleRate,
      fftSize,
      freqToMel,
      melToFreq,
    );
  } else {
    mappings = computeScaledBandMappings(
      numBands,
      minFreq,
      maxFreq,
      sampleRate,
      fftSize,
      freqToErb,
      erbToFreq,
    );
  }

  const result = new Float32Array(mappings.length * 4);

  for (let index = 0; index < mappings.length; index++) {
    const mapping = mappings[index];
    const offset = index * 4;

    if (!mapping) {
      continue;
    }

    result[offset] = mapping.binStart;
    result[offset + 1] = mapping.binEnd;
    result[offset + 2] = mapping.weightStart;
    result[offset + 3] = mapping.weightEnd;
  }

  return result;
}
