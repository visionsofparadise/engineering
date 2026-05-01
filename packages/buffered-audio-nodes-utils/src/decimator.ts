/**
 * Integer-rate polyphase-IIR decimator for Learn-only use.
 *
 * Used by the classical De-reverb Learn pass (Löllmann 2010 Eq. 11) to bring a
 * 48 kHz / 44.1 kHz source-rate signal down to ~3.2 kHz before running
 * sub-frame monotone-decrease pre-selection and Ratnam Eq. 11 ML decay-rate
 * estimation. Löllmann's sub-frame length (M = 128) and shift (M̂ = 25) are
 * defined at this downsampled rate; without the downsampling stage every
 * sub-frame statistic is at the wrong temporal scale.
 *
 * Implementation: a single biquad lowpass at `fc_norm = 0.9 / (2r)` (cycles
 * per sample at input rate) applied forward-backward (`zeroPhaseBiquadFilter`),
 * followed by every-Rth decimation. The forward-backward pass squares the
 * biquad's magnitude response, giving a 4th-order zero-phase anti-alias LP
 * equivalent to a cascade of two 2nd-order biquads but without group-delay
 * distortion of the envelope — essential for Löllmann's sub-frame
 * monotone-decrease pre-selection, which measures envelope shape on short
 * ≈18-sample windows at the downsampled rate. The factor `0.9` leaves a
 * stopband margin for the biquad's gentle roll-off. `r === 1` is a
 * defensive-copy pass-through (no filtering, no rate change).
 *
 * Stateless: each call filters the whole input buffer with zero initial state.
 * Learn-pass callers pass whole-buffer inputs, so there is no need to retain
 * filter state across calls.
 *
 * The paper is silent on the exact filter form; the biquad-cascade is the
 * minimally-invasive choice given the existing `biquad.ts` primitive. A full
 * FIR polyphase would be overkill for the Learn-only envelope statistics
 * consumed by Ratnam ML (which are phase-insensitive energy / max / min).
 *
 * @see Löllmann, Yilmaz, Jeub, Vary (2010), "An improved algorithm for blind
 *   reverberation time estimation", IWAENC 2010, Eq. 11 + Table I.
 */

import { lowPassCoefficients, zeroPhaseBiquadFilter } from "./biquad";

const MIN_R = 1;
const MAX_R = 64;

// Löllmann paper's f_eff ≈ 3.2 kHz invariant. `integerDecimationRate` picks
// the nearest integer R that brings a source rate down to this effective rate.
const LOLLMANN_F_EFF = 3200;

// Stopband margin. At r = 15 and f_s = 48000, the new Nyquist is 1600 Hz;
// placing the anti-alias cutoff at 0.9 × Nyquist = 1440 Hz leaves a small
// guard band so the biquad's roll-off has room to attenuate before Nyquist.
const CUTOFF_MARGIN = 0.9;

/**
 * Decimate `input` by integer factor `rate`. Output length is
 * `Math.floor(input.length / rate)`.
 *
 * For `rate === 1`, returns a fresh defensive copy of `input` (no filtering,
 * no decimation). For `rate ≥ 2`, applies a cascade of two biquad Butterworth
 * lowpasses at `fc_norm = 0.9 / (2 · rate)` (normalised to the input rate),
 * then samples every `rate`-th filtered sample.
 *
 * The parameter is named `rate` (not `r` as in the plan) to satisfy the
 * ≥2-char naming-convention lint rule; callers read `decimate(buf, rate)`.
 */
export function decimate(input: Float32Array, rate: number): Float32Array {
	if (!Number.isInteger(rate) || rate < MIN_R) {
		throw new Error(`decimate: rate must be a positive integer, got ${String(rate)}`);
	}

	if (rate === 1) return Float32Array.from(input);

	// Normalised cutoff in cycles per sample at the input rate. The biquad
	// coefficient helpers take (sampleRate, frequency); passing sampleRate = 1
	// makes `frequency` a normalised cutoff directly.
	const fcNorm = CUTOFF_MARGIN / (2 * rate);
	const coefficients = lowPassCoefficients(1, fcNorm);

	// Zero-phase (forward-backward) application of a single 2nd-order biquad:
	// the effective magnitude response is |H(ω)|² (4th-order), zero-phase. We
	// copy the input first because `zeroPhaseBiquadFilter` mutates in place.
	const filtered = Float32Array.from(input);

	zeroPhaseBiquadFilter(filtered, coefficients);

	const outLength = Math.floor(input.length / rate);
	const output = new Float32Array(outLength);

	for (let index = 0; index < outLength; index++) {
		output[index] = filtered[index * rate] ?? 0;
	}

	return output;
}

/**
 * Pick an integer decimation rate for a given source rate such that the
 * post-decimation effective rate is close to the Löllmann paper's
 * f_eff ≈ 3.2 kHz invariant. Known rates are pinned:
 *   - 48000 → 15 (3200 Hz)
 *   - 44100 → 14 (3150 Hz)
 * Other rates use `Math.round(sourceSampleRate / 3200)` clamped to [1, 64].
 */
export function integerDecimationRate(sourceSampleRate: number): number {
	if (sourceSampleRate === 48000) return 15;
	if (sourceSampleRate === 44100) return 14;

	const rate = Math.round(sourceSampleRate / LOLLMANN_F_EFF);

	return Math.min(MAX_R, Math.max(MIN_R, rate));
}
