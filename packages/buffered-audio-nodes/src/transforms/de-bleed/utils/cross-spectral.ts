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
 * Running sums for the streaming cross-spectral H[k] estimator. The whole-file
 * estimate is a per-bin division of the two complex cross-power sums by the
 * weighted reference auto-power sum, so these three accumulators are sufficient
 * to reproduce the one-shot result regardless of how the frames are chunked:
 *
 *   crossReal[k]         = Σ_n w[n,k] · (tR·rR + tI·rI)
 *   crossImag[k]         = Σ_n w[n,k] · (tI·rR − tR·rI)
 *   weightedAutoPower[k] = Σ_n w[n,k] · |R[n,k]|²
 *
 * All three arrays have length `numBins` and are zero-initialised by
 * `createTransferAccumulator`. Callers feed chunks of frames through
 * `accumulateTransferChunk`, then call `finalizeTransferFunction` once to
 * divide and obtain H[k].
 */
export interface TransferAccumulator {
	readonly crossReal: Float32Array;
	readonly crossImag: Float32Array;
	readonly weightedAutoPower: Float32Array;
}

/**
 * Allocate a zero-initialised {@link TransferAccumulator} sized for `numBins`
 * frequency bins. Reuse a single accumulator across all chunks of a stream;
 * do not re-create per chunk or the running sums reset.
 */
export function createTransferAccumulator(numBins: number): TransferAccumulator {
	return {
		crossReal: new Float32Array(numBins),
		crossImag: new Float32Array(numBins),
		weightedAutoPower: new Float32Array(numBins),
	};
}

/**
 * Return the maximum `|R[n,k]|²` across the given reference STFT chunk.
 *
 * The weight-denominator regulariser in `accumulateTransferChunk` is a scalar
 * `weightEpsilon = 1e-10 · (maxRefPow + 1e-20)` where `maxRefPow` must be the
 * whole-file maximum of `|R|²`, not a per-chunk maximum — otherwise streaming
 * weights drift from the one-shot estimator. Callers iterate the reference
 * chunks, call this function on each, and reduce with `Math.max` to derive the
 * whole-file `maxRefPow` before starting the accumulation pass. Non-mutating.
 */
export function findMaxRefPower(
	refReal: ReadonlyArray<Float32Array>,
	refImag: ReadonlyArray<Float32Array>,
	numFrames: number,
	numBins: number,
): number {
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

	return maxRefPow;
}

/**
 * Additively accumulate the energy-ratio-weighted cross-spectrum and weighted
 * reference auto-power for one chunk of STFT frames into the supplied
 * {@link TransferAccumulator}. Call once per chunk, reusing the same
 * accumulator across the whole stream, then finalise with
 * {@link finalizeTransferFunction}.
 *
 * For bit-compatibility with the whole-file `estimateTransferFunction`, the
 * scalar `weightEpsilon` must be `1e-10 · (maxRefPow + 1e-20)` where
 * `maxRefPow` is the maximum of `|R[n,k]|²` across the entire reference
 * stream — see {@link findMaxRefPower}. A per-chunk maximum would change the
 * weight denominator on near-silent cells and drift the estimate away from
 * the one-shot path.
 *
 * @see Welch 1967, Cohen 2003, Gerkmann & Hendriks 2012 — header JSDoc.
 */
export function accumulateTransferChunk(
	targetReal: ReadonlyArray<Float32Array>,
	targetImag: ReadonlyArray<Float32Array>,
	refReal: ReadonlyArray<Float32Array>,
	refImag: ReadonlyArray<Float32Array>,
	numFrames: number,
	numBins: number,
	weightEpsilon: number,
	accumulator: TransferAccumulator,
): void {
	const { crossReal, crossImag, weightedAutoPower } = accumulator;

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
			const weight = refPow / (targetPow + refPow + weightEpsilon);

			// Weighted T · conj(R) = (tR + j·tI)(rR - j·rI)
			//   real: tR·rR + tI·rI
			//   imag: tI·rR - tR·rI
			crossReal[bin] = crossReal[bin]! + weight * (trb * rrb + tib * rib);
			crossImag[bin] = crossImag[bin]! + weight * (tib * rrb - trb * rib);

			// Weighted |R|²
			weightedAutoPower[bin] = weightedAutoPower[bin]! + weight * refPow;
		}
	}
}

/**
 * Divide the running cross-power sums by the weighted reference auto-power to
 * yield the final complex transfer function H[k]. Call once, after all chunks
 * have been folded into `accumulator` via {@link accumulateTransferChunk}.
 *
 * The final-division regulariser is `epsilon ?? 1e-10 · max(weightedAutoPower)`
 * computed across bins here — matching the whole-file `estimateTransferFunction`
 * (it cannot be known before the last chunk has been accumulated). Pass an
 * explicit `epsilon` only to override the default policy.
 */
export function finalizeTransferFunction(
	accumulator: TransferAccumulator,
	epsilon?: number,
): TransferFunction {
	const { crossReal, crossImag, weightedAutoPower } = accumulator;
	const numBins = weightedAutoPower.length;

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
 * Delegates to the streaming accumulator API
 * ({@link findMaxRefPower} + {@link createTransferAccumulator} +
 * {@link accumulateTransferChunk} + {@link finalizeTransferFunction}) so the
 * one-shot and streaming paths cannot drift numerically.
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
	const accumulator = createTransferAccumulator(numBins);
	const maxRefPow = findMaxRefPower(refReal, refImag, numFrames, numBins);
	const weightEpsilon = 1e-10 * (maxRefPow + 1e-20);

	accumulateTransferChunk(
		targetReal,
		targetImag,
		refReal,
		refImag,
		numFrames,
		numBins,
		weightEpsilon,
		accumulator,
	);

	return finalizeTransferFunction(accumulator, epsilon);
}
