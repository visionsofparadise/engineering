/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * Per-frame Boll-style magnitude spectral subtraction gain mask with combined
 * multi-reference bleed prediction.
 *
 * Multi-reference acoustic model: the target mic sees
 *   T = A + Σᵢ Hᵢ · Rᵢ
 * where each Hᵢ is the independently-learned per-reference transfer function.
 * Bleed components from different reference mics interfere coherently, so the
 * predicted bleed is the COMPLEX sum of per-reference predictions — not the
 * sum of their magnitudes. Summing magnitudes would over-attenuate bins where
 * two references' predictions cancel each other; only the complex sum is
 * physically correct.
 *
 * The single-reference case is covered by passing length-1 arrays.
 *
 * @see Boll, S. F. (1979). "Suppression of acoustic noise in speech using
 *   spectral subtraction." IEEE Trans. ASSP, 27(2), 113–120.
 */

/**
 * Compute the per-bin Wiener-style gain mask for a single STFT frame against
 * one or more reference microphones.
 *
 * For each frequency bin, the predicted combined bleed is
 *   B_total[k] = Σᵢ Hᵢ[k] · Rᵢ[k]   (complex sum of per-reference H·R)
 * and the mask is
 *   G[k] = clamp(max(|T[k]| − α·|B_total[k]|, 0) / (|T[k]| + ε), 0, 1).
 * This function writes mask values into `outMask`; it does NOT apply the mask
 * to the target spectrum — application is done in index.ts after smoothing.
 *
 * @param targetReal    - Real part of target STFT frame, length numBins.
 * @param targetImag    - Imaginary part of target STFT frame, length numBins.
 * @param refReals      - Per-reference real STFT frame rows; length refCount, each length numBins.
 * @param refImags      - Per-reference imaginary STFT frame rows; length refCount, each length numBins.
 * @param transferReals - Per-reference H real parts; length refCount, each length numBins.
 * @param transferImags - Per-reference H imaginary parts; length refCount, each length numBins.
 * @param alpha         - Oversubtraction factor (reductionStrength / 4). α=1 subtracts
 *                        exactly the predicted bleed; α>1 oversubtracts for harder reduction.
 * @param epsilon       - Small regularizer to prevent division by zero (e.g. 1e-10).
 * @param outMask       - Output Float32Array of length numBins, reused across frames.
 *
 * @see Boll, S. F. (1979). "Suppression of acoustic noise in speech using
 *   spectral subtraction." IEEE Trans. ASSP, 27(2), 113–120.
 */
export function computeFrameGainMask(
	targetReal: Float32Array,
	targetImag: Float32Array,
	refReals: ReadonlyArray<Float32Array>,
	refImags: ReadonlyArray<Float32Array>,
	transferReals: ReadonlyArray<Float32Array>,
	transferImags: ReadonlyArray<Float32Array>,
	alpha: number,
	epsilon: number,
	outMask: Float32Array,
): void {
	const numBins = outMask.length;
	const refCount = refReals.length;

	for (let bin = 0; bin < numBins; bin++) {
		const trb = targetReal[bin]!;
		const tib = targetImag[bin]!;

		// Complex-sum per-reference predicted bleed Bᵢ = Hᵢ · Rᵢ into B_total.
		let bRTotal = 0;
		let bITotal = 0;

		for (let refIndex = 0; refIndex < refCount; refIndex++) {
			const rrb = refReals[refIndex]![bin]!;
			const rib = refImags[refIndex]![bin]!;
			const hrb = transferReals[refIndex]![bin]!;
			const hib = transferImags[refIndex]![bin]!;

			// Bᵢ = Hᵢ · Rᵢ (complex multiply)
			//   bR = hR·rR - hI·rI
			//   bI = hR·rI + hI·rR
			bRTotal += hrb * rrb - hib * rib;
			bITotal += hrb * rib + hib * rrb;
		}

		const bMag = Math.sqrt(bRTotal * bRTotal + bITotal * bITotal);
		const tMag = Math.sqrt(trb * trb + tib * tib);

		// G = max(|T| - α·|B_total|, 0) / (|T| + ε)
		const raw = Math.max(tMag - alpha * bMag, 0) / (tMag + epsilon);

		// Clamp to [0,1] defensively — max(..., 0) handles negatives;
		// values > 1 should not occur but clamp for safety.
		outMask[bin] = raw < 1 ? raw : 1;
	}
}
