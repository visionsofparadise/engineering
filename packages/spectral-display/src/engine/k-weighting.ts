export interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface BiquadState {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

export interface KWeightingCoefficients {
  stage1: BiquadCoefficients;
  stage2: BiquadCoefficients;
}

export function createBiquadState(): BiquadState {
  return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function processBiquad(
  sample: number,
  coefficients: BiquadCoefficients,
  state: BiquadState,
): number {
  const out =
    coefficients.b0 * sample +
    coefficients.b1 * state.x1 +
    coefficients.b2 * state.x2 -
    coefficients.a1 * state.y1 -
    coefficients.a2 * state.y2;

  state.x2 = state.x1;
  state.x1 = sample;
  state.y2 = state.y1;
  state.y1 = out;

  return out;
}

// BS.1770-4 Table 1 — pre-filter (high shelf)
function computeHighShelfCoefficients(sampleRate: number): BiquadCoefficients {
  const freq = 1681.974450955533;
  const gain = 3.999843853973347;
  const quality = 0.7071752369554196;

  const vh = Math.pow(10, gain / 20);
  const vb = Math.sqrt(vh);

  const kk = Math.tan((Math.PI * freq) / sampleRate);
  const k2 = kk * kk;
  const denominator = 1 + kk / quality + k2;

  return {
    b0: (vh + (vb * kk) / quality + k2) / denominator,
    b1: (2 * (k2 - vh)) / denominator,
    b2: (vh - (vb * kk) / quality + k2) / denominator,
    a1: (2 * (k2 - 1)) / denominator,
    a2: (1 - kk / quality + k2) / denominator,
  };
}

// BS.1770-4 Table 2 — RLB weighting (high pass)
function computeHighPassCoefficients(sampleRate: number): BiquadCoefficients {
  const freq = 38.13547087602444;
  const quality = 0.5003270373238773;

  const kk = Math.tan((Math.PI * freq) / sampleRate);
  const k2 = kk * kk;
  const denominator = 1 + kk / quality + k2;

  return {
    b0: 1 / denominator,
    b1: -2 / denominator,
    b2: 1 / denominator,
    a1: (2 * (k2 - 1)) / denominator,
    a2: (1 - kk / quality + k2) / denominator,
  };
}

export function computeKWeightingCoefficients(
  sampleRate: number,
): KWeightingCoefficients {
  return {
    stage1: computeHighShelfCoefficients(sampleRate),
    stage2: computeHighPassCoefficients(sampleRate),
  };
}
