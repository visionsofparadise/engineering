/**
 * De-esser sidechain utilities.
 *
 * The de-esser's sidechain detects sibilant energy by bandpass-filtering the
 * input around `frequency` (Q ≈ 2) and tracking an attack/release-smoothed
 * envelope. When the envelope exceeds `threshold` (dB), a ratio-expander gain
 * reduction is computed:
 *
 *     gr_db = (envelope_db - threshold) * (1 - 1/ratio)    clamped ≤ 0
 *     gr_db = max(range, gr_db)
 *
 * The result (gr_db, ≤ 0) is the gain reduction in dB to apply to the sibilant
 * band (split mode) or the full signal (wideband mode). Caller is responsible
 * for converting to linear and applying.
 *
 * Biquad filtering reuses the shared `biquadFilter` coefficient helpers from
 * `@e9g/buffered-audio-nodes-utils`; only the stateful per-sample stepping is
 * local here, mirroring the pattern used by the EQ node's `band-filter.ts`.
 */

import { bandPassCoefficients, type BiquadCoefficients } from "@e9g/buffered-audio-nodes-utils";

/** Per-channel biquad state for streaming sample-by-sample processing. */
export interface BiquadState {
	x1: number;
	x2: number;
	y1: number;
	y2: number;
}

export function makeBiquadState(): BiquadState {
	return { x1: 0, x2: 0, y1: 0, y2: 0 };
}

/**
 * Build bandpass coefficients for the sidechain detector.
 *
 * Thin wrapper over the shared `bandPassCoefficients` helper — centralizes
 * the Q convention (≈ 2) used by both the detection filter and the split-mode
 * band-split filter so the sidechain and audio bands stay aligned.
 */
export function makeSidechainCoefficients(sampleRate: number, frequency: number, quality: number): BiquadCoefficients {
	return bandPassCoefficients(sampleRate, frequency, quality);
}

/**
 * Process one sample through a biquad filter using Direct Form I.
 *
 * State is mutated in place; `coeffs` are the shared RBJ biquad coefficients
 * from the utils package.
 */
export function stepBiquad(sample: number, coeffs: BiquadCoefficients, state: BiquadState): number {
	const { fb, fa } = coeffs;
	const output = fb[0] * sample + fb[1] * state.x1 + fb[2] * state.x2 - fa[1] * state.y1 - fa[2] * state.y2;

	state.x2 = state.x1;
	state.x1 = sample;
	state.y2 = state.y1;
	state.y1 = output;

	return output;
}

/** Per-channel sidechain envelope state. */
export interface EnvelopeState {
	/** Current smoothed envelope value in linear amplitude (≥ 0). */
	level: number;
}

export function makeEnvelopeState(): EnvelopeState {
	return { level: 0 };
}

export interface EnvelopeCoefficients {
	readonly attack: number;
	readonly release: number;
}

/**
 * Compute EMA smoothing coefficients for attack and release (ms → coefficient
 * per sample). Zero-time means "instant" (coefficient = 0, i.e. output = target).
 */
export function makeEnvelopeCoefficients(attackMs: number, releaseMs: number, sampleRate: number): EnvelopeCoefficients {
	const attack = attackMs > 0 ? Math.exp(-1 / ((attackMs * sampleRate) / 1000)) : 0;
	const release = releaseMs > 0 ? Math.exp(-1 / ((releaseMs * sampleRate) / 1000)) : 0;

	return { attack, release };
}

/**
 * Advance the envelope follower by one sample.
 *
 * Target is the rectified sidechain sample (|x|). Attack coefficient applies
 * when the envelope is rising toward the target; release applies when the
 * envelope is falling. Returns the new level (linear amplitude).
 */
export function advanceEnvelope(target: number, state: EnvelopeState, coeffs: EnvelopeCoefficients): number {
	const rectified = target >= 0 ? target : -target;
	const coeff = rectified > state.level ? coeffs.attack : coeffs.release;

	state.level = coeff * state.level + (1 - coeff) * rectified;

	return state.level;
}

const MIN_LINEAR = 1e-10;

export function linearToDb(linear: number): number {
	return 20 * Math.log10(linear > MIN_LINEAR ? linear : MIN_LINEAR);
}

export function dbToLinear(db: number): number {
	return Math.pow(10, db / 20);
}

/**
 * Ratio-expander gain reduction, in dB (≤ 0).
 *
 * Mirrors the gate's expander formula (`(1 − 1/ratio)` slope above threshold)
 * but applied downward: when the detected level exceeds `threshold`, the
 * excess is scaled by the slope factor and negated, yielding a reduction.
 * The result is clamped to `range` (also ≤ 0), which caps the maximum
 * reduction the user is willing to apply.
 *
 * When the level is below `threshold`, returns 0 dB (no reduction).
 */
export function computeReductionDb(envelopeDb: number, thresholdDb: number, ratio: number, rangeDb: number): number {
	if (envelopeDb <= thresholdDb) return 0;

	const excess = envelopeDb - thresholdDb;
	const slope = 1 - 1 / ratio;
	const reduction = -excess * slope;

	// reduction is ≤ 0; range is ≤ 0. Cap the attenuation at `range`
	// (i.e. if computed reduction is more negative than range, clamp to range).
	return reduction < rangeDb ? rangeDb : reduction;
}
