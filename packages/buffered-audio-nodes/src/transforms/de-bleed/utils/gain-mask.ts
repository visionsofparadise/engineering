/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * Per-frame Boll-style magnitude spectral subtraction gain mask.
 *
 * Boll-style magnitude spectral subtraction with oversubtraction factor α.
 * The mask is in [0,1] and is applied to the complex target spectrum to
 * preserve phase. α > 1 subtracts more aggressively (higher reduction
 * strength) at the cost of more artifacts.
 *
 * @see Boll, S. F. (1979). "Suppression of acoustic noise in speech using
 *   spectral subtraction." IEEE Trans. ASSP, 27(2), 113–120.
 */

/**
 * Compute the per-bin Wiener-style gain mask for a single STFT frame.
 *
 * For each frequency bin, the predicted bleed is B = H·R (complex multiply).
 * The mask is G = max(|T| - α·|B|, 0) / (|T| + ε), clamped to [0,1].
 * This function writes mask values into `outMask`; it does NOT apply the mask
 * to the target spectrum — application is done in index.ts after smoothing.
 *
 * @param targetReal  - Real part of target STFT frame, length numBins.
 * @param targetImag  - Imaginary part of target STFT frame, length numBins.
 * @param refReal     - Real part of reference STFT frame, length numBins.
 * @param refImag     - Imaginary part of reference STFT frame, length numBins.
 * @param transferReal - Real part of H[k] from estimateTransferFunction, length numBins.
 * @param transferImag - Imaginary part of H[k], length numBins.
 * @param alpha       - Oversubtraction factor (reductionStrength / 4). α=1 subtracts
 *                      exactly the predicted bleed; α>1 oversubtracts for harder reduction.
 * @param epsilon     - Small regularizer to prevent division by zero (e.g. 1e-10).
 * @param outMask     - Output Float32Array of length numBins, reused across frames.
 *
 * @see Boll, S. F. (1979). "Suppression of acoustic noise in speech using
 *   spectral subtraction." IEEE Trans. ASSP, 27(2), 113–120.
 */
export function computeFrameGainMask(
	targetReal: Float32Array,
	targetImag: Float32Array,
	refReal: Float32Array,
	refImag: Float32Array,
	transferReal: Float32Array,
	transferImag: Float32Array,
	alpha: number,
	epsilon: number,
	outMask: Float32Array,
): void {
	const numBins = outMask.length;

	for (let bin = 0; bin < numBins; bin++) {
		const trb = targetReal[bin]!;
		const tib = targetImag[bin]!;
		const rrb = refReal[bin]!;
		const rib = refImag[bin]!;
		const hrb = transferReal[bin]!;
		const hib = transferImag[bin]!;

		// Predicted bleed B = H · R (complex multiply)
		// bR = hR·rR - hI·rI
		// bI = hR·rI + hI·rR
		const bR = hrb * rrb - hib * rib;
		const bI = hrb * rib + hib * rrb;

		const bMag = Math.sqrt(bR * bR + bI * bI);
		const tMag = Math.sqrt(trb * trb + tib * tib);

		// G = max(|T| - α·|B|, 0) / (|T| + ε)
		const raw = Math.max(tMag - alpha * bMag, 0) / (tMag + epsilon);

		// Clamp to [0,1] defensively — max(..., 0) handles negatives;
		// values > 1 should not occur but clamp for safety.
		outMask[bin] = raw < 1 ? raw : 1;
	}
}
