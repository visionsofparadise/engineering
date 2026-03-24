const OVERSAMPLING = 4;
const TAPS_PER_PHASE = 12;
const FILTER_LENGTH = TAPS_PER_PHASE * OVERSAMPLING;

export interface TruePeakState {
  buffer: Float32Array;
  index: number;
}

export function createTruePeakState(): TruePeakState {
  return {
    buffer: new Float32Array(TAPS_PER_PHASE * 2),
    index: 0,
  };
}

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;

  for (let ki = 1; ki <= 25; ki++) {
    term *= (x / (2 * ki)) * (x / (2 * ki));
    sum += term;
  }

  return sum;
}

function computePhases(): Array<Float32Array> {
  const center = (FILTER_LENGTH - 1) / 2;
  const prototype = new Float32Array(FILTER_LENGTH);

  const beta = 9;
  const i0Beta = besselI0(beta);

  for (let ni = 0; ni < FILTER_LENGTH; ni++) {
    const x = (ni - center) / OVERSAMPLING;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const arg = 2 * ni / (FILTER_LENGTH - 1) - 1;
    const win = besselI0(beta * Math.sqrt(Math.max(0, 1 - arg * arg))) / i0Beta;

    prototype[ni] = sinc * win;
  }

  const phases: Array<Float32Array> = [];

  for (let ph = 0; ph < OVERSAMPLING; ph++) {
    const phase = new Float32Array(TAPS_PER_PHASE);

    for (let ti = 0; ti < TAPS_PER_PHASE; ti++) {
      phase[ti] = prototype[OVERSAMPLING * ti + ph]!;
    }

    const dcGain = phase.reduce((sum, coeff) => sum + coeff, 0);

    if (dcGain > 0) {
      for (let ti = 0; ti < TAPS_PER_PHASE; ti++) {
        phase[ti] = phase[ti]! / dcGain;
      }
    }

    phases.push(phase);
  }

  return phases;
}

const truePeakPhases = computePhases();

export function truePeakMaxAbs(sample: number, state: TruePeakState): number {
  const { buffer } = state;

  buffer[state.index] = sample;
  buffer[state.index + TAPS_PER_PHASE] = sample;

  state.index = state.index + 1;

  if (state.index >= TAPS_PER_PHASE) state.index = 0;

  const readBase = state.index;
  let maxAbs = 0;

  for (let ph = 0; ph < OVERSAMPLING; ph++) {
    const phase = truePeakPhases[ph]!;
    let sum = 0;

    for (let ti = 0; ti < TAPS_PER_PHASE; ti++) {
      sum += phase[ti]! * buffer[readBase + TAPS_PER_PHASE - 1 - ti]!;
    }

    const abs = sum < 0 ? -sum : sum;

    if (abs > maxAbs) maxAbs = abs;
  }

  return maxAbs;
}
