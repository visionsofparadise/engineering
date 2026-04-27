// Spectral correction + recombination + OLA synthesis for Ruhland 2015 BMRI
// (§II.D, Eq. 16).
//
// After per-block LSAR interpolation, the re-DFT'd residual `R̃[k,λ]` may
// regain energy in bins that the §II.A binary mask had kept in the target
// path. Ruhland §II.D zeroes those bins in `R̃[k,λ]` before recombining, so
// mask-kept bins carry target-path energy exclusively and mask-rejected
// bins carry the AR-cleaned residual's energy exclusively. The paper notes
// the correction has "slight influence on the whole time-domain signal
// block" but the net effect is the intended per-cell separation of target /
// residual energies.
//
// Recombination is Eq. 16: `ŷ[λM+n] = t[λM+n] + r̃_corrected[λM+n]`, then
// Hann-windowed 50%-overlap-add synthesis produces the output waveform.
//
// Mask convention (matches `bmri-mask.ts`):
//   mask[frame * bins + bin] === 1  →  mask-rejected (residual bin)
//   mask[frame * bins + bin] === 0  →  mask-kept (target bin, zero in R̃)
//
// The correction zeroes `R̃[k,λ]` at cells where `mask === 0` — exactly the
// bins the target carries.

import { istft, type FftBackend, type StftResult } from "@e9g/buffered-audio-nodes-utils";

/**
 * Apply Ruhland §II.D spectral correction and recombine target + residual
 * into the restored output signal.
 *
 * - `target`: the mask-kept STFT (from `applyBinaryMask` / `resplitWithDilatedMask`).
 * - `residualInterpolated`: the re-DFT of the per-block-LSAR-interpolated
 *   residual time-domain signal. Mutated in place by the spectral-correction
 *   step (bins where `mask === 0` are zeroed).
 * - `mask`: the (possibly dilated) binary TF mask used by the target/residual
 *   split. Same layout as `applyBinaryMask`'s return.
 * - `fftSize`, `hopSize`: STFT parameters, matching the analysis STFT.
 * - `outputLength`: the target output signal length in samples.
 * - `backend`, `fftAddonOptions`: FFT acceleration, forwarded to `istft`.
 *
 * Returns the recombined waveform `ŷ[n]` truncated to `outputLength`.
 */
export function spectralCorrectAndRecombine(
	target: StftResult,
	residualInterpolated: StftResult,
	mask: Uint8Array,
	fftSize: number,
	hopSize: number,
	outputLength: number,
	backend?: FftBackend,
	fftAddonOptions?: { vkfftPath?: string; fftwPath?: string },
): Float32Array {
	const numBins = fftSize / 2 + 1;
	const { frames } = residualInterpolated;
	const total = numBins * frames;

	// Spectral correction: zero bins of R̃ where the mask kept the bin for the
	// target path (mask === 0). residualInterpolated's Float32Array backing is
	// mutable; we write directly.
	const residualReal = residualInterpolated.real;
	const residualImag = residualInterpolated.imag;

	for (let idx = 0; idx < total; idx++) {
		if ((mask[idx] ?? 0) === 0) {
			residualReal[idx] = 0;
			residualImag[idx] = 0;
		}
	}

	// iSTFT both paths with the same hop / fftSize / window. The utils `istft`
	// applies Hann windowing and COLA normalisation internally.
	const targetTime = istft(target, hopSize, outputLength, backend, fftAddonOptions);
	const residualTime = istft(residualInterpolated, hopSize, outputLength, backend, fftAddonOptions);

	// Eq. 16: sample-by-sample sum.
	const restored = new Float32Array(outputLength);

	for (let i = 0; i < outputLength; i++) {
		restored[i] = (targetTime[i] ?? 0) + (residualTime[i] ?? 0);
	}

	return restored;
}
