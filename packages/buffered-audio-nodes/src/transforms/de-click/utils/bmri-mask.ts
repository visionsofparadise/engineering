// Adaptive-threshold binary masking for Ruhland 2015 BMRI (§II.A, §II.A.1).
//
// Per-bin, per-frame squared magnitudes |Y[k,λ]|² are compared to an adaptive
// threshold `ξ̂[k,λ]` where:
//   - `Φ̂_YY[k,λ]` is a recursively smoothed periodogram estimate (§II.A.1
//     Eq. 7) with attack/release time constants (Eqs. 8–10). Ruhland's
//     default τ_att = 10 s, τ_rel = 0.5 s (per design-declick; τ_att is
//     UNVERIFIED against the PDF figure, matching design-declick's note).
//     First-frame init is `Φ̂_YY[k,0] = |Y[k,0]|²` per design-declick.
//   - `β[k] = β_dec · log10(k · fs / (L · f_ref))` dB (§II.A.1 Eq. 11).
//     Default β_dec = 5 dB/dec, f_ref = 1000 Hz.
//
// Implementation deviation from Ruhland Eq. 6. Ruhland writes
// `ξ̂ = Φ̂_YY + β[k]` with `Φ̂_YY` in linear power (Eq. 7) and `β[k]` a
// dB-slope quantity (Eq. 11). The literal additive linear-power reading is
// dimensionally inconsistent (dB + linear power), and empirically (Phase-7
// post-fix Pierce-fixture mask-statistics dump — scratch/bmri-mask-stats.mjs)
// produces a ~98%-per-frame mask-rejection rate because `10^(β_dB/10)` at
// high k evaluates to a large *constant* that dominates `Φ̂_YY`, pinning the
// threshold well above any real bin power and routing almost every TF cell
// to the residual. We interpret `β[k]` as a multiplicative *gain* on the
// noise-floor estimate (equivalent to `+β_dB` in log-power space), clamped
// to β_dB ≥ 0 so the threshold is never more permissive than the smoothed
// floor at low frequencies. Concretely:
//   `ξ̂[k,λ] = Φ̂_YY[k,λ] · 10^(max(0, β_dB[k]) / 10)` (linear power).
// This preserves the paper's stated intent ("increasing offset … over
// frequency" in dB) while producing sane masks on music/voice material.
// See design-declick Decisions log entry 2026-04-24 for full rationale and
// before/after numerics.
//
// Mask convention used throughout the BMRI pipeline:
//   mask[frame * bins + bin] === 1  →  mask-rejected (|Y|² < threshold) → residual
//   mask[frame * bins + bin] === 0  →  mask-kept    (|Y|² ≥ threshold) → target
//
// `clickWidening` (design-declick's composition on top of BMRI) is implemented
// as `dilateMaskTFCells` — a rectangular morphological dilation on the binary
// mask. After dilation the caller invokes `resplitWithDilatedMask` to rebuild
// the target/residual STFTs consistent with the widened mask.
//
// `minFrequency` / `maxFrequency` band restriction (design-declick's second
// composition on top of BMRI, decision log 2026-04-24): bins whose centre
// frequency sits outside the `[minFrequency, maxFrequency]` band are
// force-kept in the target path (mask = 0) regardless of the adaptive
// threshold comparison. Implemented in `applyBinaryMask` via the optional
// `BandRestriction` argument. Rationale: RX's Mouth De-click empirically
// band-limits detection to roughly 100 Hz – 5 kHz; BMRI without a cap flags
// high-frequency sibilance/breath as clicks because the adaptive threshold
// still fires on low-level HF content, producing an audibly "sizzly, high
// range" residual rather than RX's mid-band click-only signature.

import type { StftResult } from "@e9g/buffered-audio-nodes-utils";

export interface BmriThresholdOptions {
	readonly tauAttSeconds: number;
	readonly tauRelSeconds: number;
	readonly betaDecDbPerDecade: number;
	readonly fRefHz: number;
}

/**
 * Default BMRI threshold-estimator parameters per design-declick
 * "Algorithm-internal scalars not exposed":
 *   τ_att = 10 s, τ_rel = 0.5 s, β_dec = 5 dB/dec, f_ref = 1000 Hz.
 */
export const DEFAULT_BMRI_THRESHOLD_OPTIONS: BmriThresholdOptions = {
	tauAttSeconds: 10,
	tauRelSeconds: 0.5,
	betaDecDbPerDecade: 5,
	fRefHz: 1000,
};

/**
 * Compute the per-bin-per-frame adaptive threshold `ξ̂[k,λ]` in linear power.
 *
 * Output layout: `Float32Array` of length `numBins * frames`, row-major by
 * frame (frame index is the slow axis). `numBins = fftSize / 2 + 1`.
 *
 * Per-frame smoothing chooses the attack α when `|Y[k,λ]|² > Φ̂_YY[k,λ-1]`
 * (threshold rising) and the release α otherwise (threshold falling), per
 * §II.A.1 Eqs. 8–10. Ruhland's rationale: the long τ_att keeps the threshold
 * from following fast transients, while the short τ_rel lets it track the
 * noise floor back down after a transient passes.
 *
 * First-frame initialisation: `Φ̂_YY[k,0] = |Y[k,0]|²`.
 */
export function computeAdaptiveThreshold(
	spectra: StftResult,
	sampleRate: number,
	fftSize: number,
	hopSize: number,
	options: BmriThresholdOptions = DEFAULT_BMRI_THRESHOLD_OPTIONS,
): Float32Array {
	const numBins = fftSize / 2 + 1;
	const frames = spectra.frames;
	const threshold = new Float32Array(numBins * frames);

	if (frames === 0) return threshold;

	// Recursion coefficients per §II.A.1 Eqs. 8–10: α = exp(-M / (fs · τ)).
	const alphaAtt = Math.exp(-hopSize / (sampleRate * options.tauAttSeconds));
	const alphaRel = Math.exp(-hopSize / (sampleRate * options.tauRelSeconds));

	// Per-bin 1/f-compensating gain β[k] as a linear-power multiplicative
	// factor. Computed as `10^(max(0, β_dec · log10(k·fs / (L·f_ref))) / 10)`.
	//
	// The `max(0, …)` clamp guards against the paper's Eq. 11 going negative
	// at bins below f_ref. A negative `β_dB` would scale the threshold *below*
	// the smoothed noise-floor estimate, making the mask more permissive at
	// low frequencies than at the floor itself — the opposite of the paper's
	// stated intent ("increasing offset … over frequency"). Clamping keeps
	// β_dB ≥ 0 everywhere so the threshold is always ≥ `Φ̂_YY`, which matches
	// the paper's rationale for the offset (compensate for music's long-term
	// 1/f spectrum by raising the threshold at high frequencies).
	//
	// At k=0 the log10 argument is zero. The formula is undefined there; we
	// pin βGain[0] = βGain[1] as a practical convention — DC is outside the
	// audible 1/f-slope region §II.A.1's rationale models.
	const betaGain = new Float32Array(numBins);

	for (let bin = 1; bin < numBins; bin++) {
		const binFreq = bin * sampleRate;
		const betaDbRaw = options.betaDecDbPerDecade * Math.log10(binFreq / (fftSize * options.fRefHz));
		const betaDb = Math.max(0, betaDbRaw);

		betaGain[bin] = Math.pow(10, betaDb / 10);
	}

	betaGain[0] = betaGain[1] ?? 1;

	// Running Φ̂_YY[k,λ] buffer (one per bin). Initialised from frame 0.
	const phi = new Float64Array(numBins);

	for (let bin = 0; bin < numBins; bin++) {
		const re = spectra.real[bin] ?? 0;
		const im = spectra.imag[bin] ?? 0;
		const power = re * re + im * im;

		phi[bin] = power;
		threshold[bin] = power * (betaGain[bin] ?? 1);
	}

	for (let frame = 1; frame < frames; frame++) {
		const rowOffset = frame * numBins;

		for (let bin = 0; bin < numBins; bin++) {
			const re = spectra.real[rowOffset + bin] ?? 0;
			const im = spectra.imag[rowOffset + bin] ?? 0;
			const power = re * re + im * im;
			const prevPhi = phi[bin] ?? 0;
			// Attack when the input rises above the running estimate, release otherwise.
			const alpha = power > prevPhi ? alphaAtt : alphaRel;
			const nextPhi = alpha * prevPhi + (1 - alpha) * power;

			phi[bin] = nextPhi;
			threshold[rowOffset + bin] = nextPhi * (betaGain[bin] ?? 1);
		}
	}

	return threshold;
}

export interface BinaryMaskResult {
	readonly target: StftResult;
	readonly residual: StftResult;
	readonly mask: Uint8Array;
}

/**
 * Optional band restriction on `applyBinaryMask`. Bins whose centre frequency
 * sits below `minFrequencyHz` or above `maxFrequencyHz` are force-kept in the
 * target path (mask = 0) regardless of the adaptive-threshold comparison.
 *
 * Rationale (design-declick Decisions log 2026-04-24 band-restriction entry):
 * iZotope RX's Mouth De-click A/B on Pierce reference shows RX's residual is
 * band-limited to roughly 100 Hz – 5 kHz, whereas BMRI without a band cap
 * flags high-frequency sibilance / breath / air content as clicks and
 * produces a residual that is audibly "sizzly, high range" rather than
 * RX's mid-band "tiny filtered clicks". Restricting detection to the band
 * where mouth clicks concentrate (per the calibration Phase-1 measurements
 * placing mouth-click TF energy in 2–8 kHz, with RX empirically capping at
 * ~5 kHz) matches the perceptual signature without changing the BMRI
 * structural property outside the band.
 *
 * `undefined` on either bound means "no restriction on that end":
 *   - `minFrequencyHz` omitted or 0 → only DC (bin 0) is force-kept, which
 *     is effectively no low cutoff.
 *   - `maxFrequencyHz` omitted or ≥ Nyquist → all bins up through
 *     `fftSize/2` participate in the threshold test.
 */
export interface BandRestriction {
	readonly minFrequencyHz?: number;
	readonly maxFrequencyHz?: number;
	readonly sampleRate: number;
	readonly fftSize: number;
}

/**
 * Convert a frequency in Hz to a bin index at the given sample rate and FFT
 * size. `binIndex = round(freq · fftSize / sampleRate)`. Zero Hz is bin 0;
 * Nyquist is bin `fftSize / 2`. Returned bin index is clamped to the valid
 * `[0, fftSize/2]` range.
 */
export function frequencyToBin(freqHz: number, sampleRate: number, fftSize: number): number {
	const bin = Math.round((freqHz * fftSize) / sampleRate);

	return Math.max(0, Math.min(fftSize / 2, bin));
}

/**
 * Split an STFT into target (mask-kept) and residual (mask-rejected) paths
 * per Ruhland §II.A Eqs. 4–5.
 *
 * `mask[frame * bins + bin] = 1` when `|Y[k,λ]|² < threshold[frame * bins + bin]`
 * (the bin is below the adaptive threshold → sent to the residual). In those
 * cells `target.real/imag = 0` and `residual.real/imag = Y`. In the `mask = 0`
 * (mask-kept) cells vice versa.
 *
 * If `band` is supplied, bins outside `[minBin, maxBin]` are force-kept in
 * the target (mask = 0) regardless of the threshold comparison. See
 * `BandRestriction` for the RX A/B rationale behind this knob.
 */
export function applyBinaryMask(spectra: StftResult, threshold: Float32Array, band?: BandRestriction): BinaryMaskResult {
	const { fftSize, frames } = spectra;
	const numBins = fftSize / 2 + 1;
	const total = numBins * frames;

	const targetReal = new Float32Array(total);
	const targetImag = new Float32Array(total);
	const residualReal = new Float32Array(total);
	const residualImag = new Float32Array(total);
	const mask = new Uint8Array(total);

	// Resolve band edges to bin indices. Bins in `[minBin, maxBin]` participate
	// in the threshold test; bins outside are force-kept. Defaults collapse the
	// restriction to a pass-through: minBin = 0 and maxBin = numBins - 1 (i.e.
	// Nyquist bin).
	let minBin = 0;
	let maxBin = numBins - 1;

	if (band !== undefined) {
		if (band.minFrequencyHz !== undefined && band.minFrequencyHz > 0) {
			minBin = frequencyToBin(band.minFrequencyHz, band.sampleRate, band.fftSize);
		}

		if (band.maxFrequencyHz !== undefined && Number.isFinite(band.maxFrequencyHz)) {
			maxBin = frequencyToBin(band.maxFrequencyHz, band.sampleRate, band.fftSize);
		}
	}

	for (let frame = 0; frame < frames; frame++) {
		const rowOffset = frame * numBins;

		for (let bin = 0; bin < numBins; bin++) {
			const index = rowOffset + bin;
			const re = spectra.real[index] ?? 0;
			const im = spectra.imag[index] ?? 0;
			const power = re * re + im * im;
			const thr = threshold[index] ?? 0;
			const inBand = bin >= minBin && bin <= maxBin;

			if (inBand && power < thr) {
				mask[index] = 1;
				residualReal[index] = re;
				residualImag[index] = im;
			} else {
				targetReal[index] = re;
				targetImag[index] = im;
			}
		}
	}

	const target: StftResult = { real: targetReal, imag: targetImag, frames, fftSize };
	const residual: StftResult = { real: residualReal, imag: residualImag, frames, fftSize };

	return { target, residual, mask };
}

/**
 * Morphological binary dilation of a TF mask by a rectangular structuring
 * element of half-widths (`radiusFrames`, `radiusBins`). Returns a new
 * `Uint8Array`; the input is not modified.
 *
 * Mask layout matches `applyBinaryMask`: row-major by frame, `mask[frame * bins + bin]`.
 *
 * Used by design-declick's `clickWidening` composition on top of BMRI: a cell
 * is set to 1 if any cell within the rectangle `[frame ± radiusFrames,
 * bin ± radiusBins]` is 1 in the input.
 */
export function dilateMaskTFCells(mask: Uint8Array, frames: number, bins: number, radiusFrames: number, radiusBins: number): Uint8Array {
	const out = new Uint8Array(mask.length);

	if (radiusFrames <= 0 && radiusBins <= 0) {
		out.set(mask);

		return out;
	}

	for (let frame = 0; frame < frames; frame++) {
		const frameLo = Math.max(0, frame - radiusFrames);
		const frameHi = Math.min(frames - 1, frame + radiusFrames);

		for (let bin = 0; bin < bins; bin++) {
			const binLo = Math.max(0, bin - radiusBins);
			const binHi = Math.min(bins - 1, bin + radiusBins);
			let hit = 0;

			outer: for (let f = frameLo; f <= frameHi; f++) {
				const rowOffset = f * bins;

				for (let b = binLo; b <= binHi; b++) {
					if ((mask[rowOffset + b] ?? 0) === 1) {
						hit = 1;

						break outer;
					}
				}
			}

			out[frame * bins + bin] = hit;
		}
	}

	return out;
}

export interface ResplitResult {
	readonly target: StftResult;
	readonly residual: StftResult;
}

/**
 * Rebuild target and residual STFTs from the original spectra and a
 * (possibly dilated) binary mask. Mirrors `applyBinaryMask`'s mask convention:
 * `mask === 1` → bin goes to residual, `mask === 0` → bin goes to target.
 */
export function resplitWithDilatedMask(spectra: StftResult, mask: Uint8Array): ResplitResult {
	const { fftSize, frames } = spectra;
	const numBins = fftSize / 2 + 1;
	const total = numBins * frames;

	const targetReal = new Float32Array(total);
	const targetImag = new Float32Array(total);
	const residualReal = new Float32Array(total);
	const residualImag = new Float32Array(total);

	for (let idx = 0; idx < total; idx++) {
		const re = spectra.real[idx] ?? 0;
		const im = spectra.imag[idx] ?? 0;

		if ((mask[idx] ?? 0) === 1) {
			residualReal[idx] = re;
			residualImag[idx] = im;
		} else {
			targetReal[idx] = re;
			targetImag[idx] = im;
		}
	}

	return {
		target: { real: targetReal, imag: targetImag, frames, fftSize },
		residual: { real: residualReal, imag: residualImag, frames, fftSize },
	};
}
