// Closed-form inversion of the Nercessian & Lukin 2019 DAFx-19 §2.1 forward
// model. Given the learned reverb profile (scalar α, per-band β) and the
// observed STFT magnitude |Y_t(k)|, we invert Eq. (1) and Eq. (2) jointly to
// recover an estimate of the dry magnitude ŝ_t(k) and form a raw attenuation
// gain G_raw(t, k) = ŝ_t(k) / (|Y_t(k)| + ε). The raw mask is the input to
// the Lukin-Todd 2007 NLM+DFTT post-filter; this module does not smooth, clip,
// or otherwise post-process the gain.
//
// Forward model (Nercessian & Lukin 2019 §2.1):
//   r_t = α · s_t + (1 − α) · r_{t−1}        (Eq. 1)
//   y_t = s_t + β · r_t                      (Eq. 2)
//
// Joint inversion per bin k, with β_b the per-band β for the band containing
// bin k and ε = 1e-10:
//   r_t(k) = (α · |Y_t(k)| + (1 − α) · r_{t−1}(k)) / (1 + α · β_b)
//   ŝ_t(k) = max(|Y_t(k)| − β_b · r_t(k),  0)
//   G_raw[t, k] = ŝ_t(k) / (|Y_t(k)| + ε)
//
// The `reductionScale ∈ [0, 1]` parameter scales the applied β:
//   β_applied[b] = reductionScale · β_learned[b].
// This is the caller-normalised form of the user `reduction` control. Per
// `design-dereverb.md` §"Parameter surface mapping", `reduction` has max 10;
// the caller passes `reductionScale = reduction / 10`. At reductionScale = 0
// the subtraction is disabled and G_raw = 1 identically (pass-through).
//
// @see Nercessian, S. & Lukin, A. (2019). "Speech dereverberation using
//   recurrent neural networks." Proc. DAFx-19. §2.1 (Eq. 1 and Eq. 2).
// @see `design-dereverb.md` §"Forward model" and §"Gain computation".

import type { BandBinRange } from "./bands";

const EPSILON = 1e-10;

// Canonical band order. Must match `learnReverbProfile`'s β tuple ordering:
// `[low, lowMid, highMid, high]` → `beta[0..3]`.
const BAND_KEYS: readonly ["low", "lowMid", "highMid", "high"] = ["low", "lowMid", "highMid", "high"];

/**
 * Per-channel state for the reverb magnitude recursion. Stores r_{t−1}(k),
 * the previous frame's multi-path magnitude estimate per bin.
 */
export interface ReverbState {
	readonly numBins: number;
	readonly rPrev: Float32Array;
}

export function createReverbState(numBins: number): ReverbState {
	return {
		numBins,
		rPrev: new Float32Array(numBins),
	};
}

/**
 * Apply the Eq. (1) + (2) closed-form inversion per bin for one STFT frame.
 * Writes the raw gain G_raw into `gain` and updates `state.rPrev` in place.
 *
 * Per band b, uses `β_applied = reductionScale · β[b]` for every bin in the
 * band's `[start, end)` bin range. Does not clamp gain to `[0, 1]`; clamping
 * happens in the DFTT tail of the post-filter.
 *
 * @param magY        |Y_t(k)| per bin (length numBins).
 * @param alpha       Scalar α from the reverb profile.
 * @param beta        Per-band β tuple `[low, lowMid, highMid, high]`.
 * @param bandBinRanges Band-bin layout from `bandBinGroups(fftSize, sampleRate)`.
 * @param reductionScale `reduction / maxReduction` ∈ [0, 1].
 * @param state       Per-channel reverb state; `rPrev` is read and written.
 * @param gain        Output raw gain per bin (length numBins).
 */
export function computeRawGain(
	magY: Float32Array,
	alpha: number,
	beta: readonly [number, number, number, number],
	bandBinRanges: BandBinRange,
	reductionScale: number,
	state: ReverbState,
	gain: Float32Array,
): void {
	const numBins = gain.length;
	const rPrev = state.rPrev;

	for (let bandIndex = 0; bandIndex < BAND_KEYS.length; bandIndex++) {
		const bandKey = BAND_KEYS[bandIndex] ?? "low";
		const [startBin, endBin] = bandBinRanges[bandKey];
		const betaApplied = reductionScale * (beta[bandIndex] ?? 0);
		const denom = 1 + alpha * betaApplied;
		const lo = Math.max(0, startBin);
		const hi = Math.min(numBins, endBin);

		for (let bin = lo; bin < hi; bin++) {
			const magObs = magY[bin] ?? 0;
			const prev = rPrev[bin] ?? 0;

			// Eq. (1) inverted with Eq. (2) substituted in:
			//   r_t = (α·|Y| + (1 − α)·r_{t−1}) / (1 + α·β)
			const reverbEst = (alpha * magObs + (1 - alpha) * prev) / denom;
			// Eq. (2) solved for ŝ with the non-negativity clamp from §2.1:
			//   ŝ = max(|Y| − β·r, 0)
			const dryEst = Math.max(magObs - betaApplied * reverbEst, 0);

			rPrev[bin] = reverbEst;
			gain[bin] = dryEst / (magObs + EPSILON);
		}
	}
}

/**
 * Decibel → linear magnitude factor. Used by the caller to compute the
 * `boostLin` argument for {@link applyEnhanceDry} when `enhanceDry` is
 * enabled.
 */
export function enhanceDryBoostLin(dB: number): number {
	return Math.pow(10, dB / 20);
}

/**
 * Optional cosmetic stage: multiply bins whose gain > 0.9 (i.e. the estimator
 * considers them overwhelmingly dry) by `boostLin`. Matches RX Dialogue
 * De-reverb's "Enhance Dry" control, which nudges dry-dominant bins upward to
 * counteract the Wiener-style gain's sub-unity behaviour even in high-SNR
 * bins.
 *
 * Mutates `gain` in place.
 */
export function applyEnhanceDry(gain: Float32Array, boostLin: number): void {
	const numBins = gain.length;

	for (let bin = 0; bin < numBins; bin++) {
		const value = gain[bin] ?? 0;

		if (value > 0.9) gain[bin] = value * boostLin;
	}
}
