/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * Per-bin complex transfer function from energy-ratio-weighted cross-spectral
 * density estimation.
 *
 *   w[n,k] = |R[n,k]|² / (|T[n,k]|² + |R[n,k]|² + ε)
 *   H[k]   = Σ_n w[n,k]·T[n,k]·conj(R[n,k]) / (Σ_n w[n,k]·|R[n,k]|² + ε)
 *
 * Signal model: the target mic carries `T = A + h·R_direct` (target's own voice
 * A plus bleed path h applied to the reference speaker's direct voice), and the
 * reference mic carries `R = R_direct + g·A` (reference speaker plus leakage of
 * the target's own voice into the reference mic). The latter leakage is
 * structurally unavoidable with co-recorded mics and introduces a bias term
 * `conj(g)·E[|A|²]` into the naïve cross-spectrum `E[T·R*]` that does not vanish
 * with more frames. Uniform Welch averaging cannot remove it.
 *
 * The per-TF-cell weight `w[n,k]` is the posterior probability that the
 * observation at cell (n,k) is reference-dominant under a simple Gaussian
 * signal model — equivalent to a soft double-talk detector applied per bin.
 * Frames where |R| ≫ |T| (reference speaker talking, target quiet) carry full
 * weight and contribute an unbiased cross-spectral estimate; frames where
 * |T| ≫ |R| (target dominant, leakage contaminates the estimate) are
 * downweighted to near zero. The result is a complex H[k] whose magnitude
 * encodes per-bin bleed gain and whose phase encodes the inter-mic delay —
 * directly usable to predict B[n,k] = H[k]·R[n,k].
 *
 * This is weighted LMMSE / weighted Welch cross-spectral estimation: a
 * composition of classical Welch averaging with soft speech-presence-
 * probability weighting from the speech-enhancement and acoustic-echo-
 * cancellation literatures. Patent-clean (stays inside textbook signal
 * processing; does not touch the Accusonus PSD-WE technique from Kokkinis 2012).
 *
 * @see Welch, P. (1967). "The use of fast Fourier transform for the estimation
 *   of power spectra." IEEE Trans. Audio Electroacoustics, 15(2), 70–73.
 * @see Cohen, I. (2003). "Noise spectrum estimation in adverse environments:
 *   Improved minima controlled recursive averaging." IEEE Trans. Speech & Audio
 *   Processing, 11(5), 466–475.
 * @see Gerkmann, T. & Hendriks, R. C. (2012). "Unbiased MMSE-Based Noise Power
 *   Estimation with Low Complexity and Low Tracking Delay." IEEE TASLP, 20(4),
 *   1383–1393.
 * @see Boll, S. F. (1979). "Suppression of acoustic noise in speech using
 *   spectral subtraction." IEEE Trans. ASSP, 27(2), 113–120.
 */

export interface TransferFunction {
	readonly real: Float32Array;
	readonly imag: Float32Array;
}

/**
 * Estimate the complex bleed transfer function H[k] from the energy-ratio-
 * weighted cross-spectral density of the target and reference STFTs.
 *
 * Each time-frequency cell contributes to the sum with weight
 * `w[n,k] = |R[n,k]|² / (|T[n,k]|² + |R[n,k]|² + ε)` — the posterior
 * probability that the reference dominates at that cell. Cells where the
 * target dominates (which contain target-leakage bias) are downweighted;
 * cells where the reference dominates contribute unbiased estimates of
 * the bleed path.
 *
 * Same whole-file processing as unweighted Welch, with the same output shape.
 *
 * @see Welch 1967, Cohen 2003, Gerkmann & Hendriks 2012 — header JSDoc.
 */
export function estimateTransferFunction(
	targetReal: ReadonlyArray<Float32Array>,
	targetImag: ReadonlyArray<Float32Array>,
	refReal: ReadonlyArray<Float32Array>,
	refImag: ReadonlyArray<Float32Array>,
	numFrames: number,
	numBins: number,
	epsilon?: number,
): TransferFunction {
	// Accumulators for weighted cross-power (complex) and weighted reference auto-power (real)
	const crossReal = new Float32Array(numBins);
	const crossImag = new Float32Array(numBins);
	const weightedAutoPower = new Float32Array(numBins);

	// Pre-pass: find a small ε_weight scaled to the reference's typical magnitude,
	// to stabilise the w[n,k] denominator in TF cells where both T and R are near-silent.
	let maxRefPow = 0;

	for (let frame = 0; frame < numFrames; frame++) {
		const rR = refReal[frame]!;
		const rI = refImag[frame]!;

		for (let bin = 0; bin < numBins; bin++) {
			const rrb = rR[bin]!;
			const rib = rI[bin]!;
			const refPow = rrb * rrb + rib * rib;

			if (refPow > maxRefPow) maxRefPow = refPow;
		}
	}

	const weightEps = 1e-10 * (maxRefPow + 1e-20);

	for (let frame = 0; frame < numFrames; frame++) {
		const tR = targetReal[frame]!;
		const tI = targetImag[frame]!;
		const rR = refReal[frame]!;
		const rI = refImag[frame]!;

		for (let bin = 0; bin < numBins; bin++) {
			const trb = tR[bin]!;
			const tib = tI[bin]!;
			const rrb = rR[bin]!;
			const rib = rI[bin]!;

			const targetPow = trb * trb + tib * tib;
			const refPow = rrb * rrb + rib * rib;

			// w[n,k] = |R|² / (|T|² + |R|² + ε) — soft reference-dominance weight
			const weight = refPow / (targetPow + refPow + weightEps);

			// Weighted T · conj(R) = (tR + j·tI)(rR - j·rI)
			//   real: tR·rR + tI·rI
			//   imag: tI·rR - tR·rI
			crossReal[bin] = crossReal[bin]! + weight * (trb * rrb + tib * rib);
			crossImag[bin] = crossImag[bin]! + weight * (tib * rrb - trb * rib);

			// Weighted |R|²
			weightedAutoPower[bin] = weightedAutoPower[bin]! + weight * refPow;
		}
	}

	// Regulariser for the final division: ε_bin = epsilon ?? 1e-10 · max(weightedAutoPower)
	let maxAutoPower = 0;

	for (let bin = 0; bin < numBins; bin++) {
		if (weightedAutoPower[bin]! > maxAutoPower) maxAutoPower = weightedAutoPower[bin]!;
	}

	const eps = epsilon ?? 1e-10 * maxAutoPower;

	const hReal = new Float32Array(numBins);
	const hImag = new Float32Array(numBins);

	for (let bin = 0; bin < numBins; bin++) {
		const denom = weightedAutoPower[bin]! + eps;

		hReal[bin] = crossReal[bin]! / denom;
		hImag[bin] = crossImag[bin]! / denom;
	}

	return { real: hReal, imag: hImag };
}
