/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * 2D Non-Local Means smoothing of a gain mask to suppress musical noise
 * artifacts in spectral-subtraction-based noise reduction.
 *
 * Parameters (patch size, search range, paste block size) are the exact
 * values reported by iZotope's principal DSP engineer in:
 *
 * @see Lukin, A. & Todd, J. (2007). "Suppression of Musical Noise Artifacts
 *   in Audio Noise Reduction by Adaptive 2D Filtering." 123rd AES Convention,
 *   Paper 7168. PDF: http://imaging.cs.msu.ru/pub/MusicalNoise07.pdf
 * @see Buades, A., Coll, B., Morel, J. (2005). "Image Denoising By Non-Local
 *   Averaging." IEEE ICASSP 2005, vol. 2, pp. 25–28.
 */

/**
 * Parameters for the NLM smoothing stage.
 *
 * Default values match Lukin & Todd 2007, Section 4.3 exactly.
 */
export interface NlmParams {
	/** Patch size for similarity comparison (8). */
	readonly patchSize: number;
	/** Search range along the frequency axis, ±bins (8). */
	readonly searchFreqRadius: number;
	/** Search range into the past along the time axis, in frames (16). */
	readonly searchTimePre: number;
	/** Search range into the future along the time axis, in frames (4). */
	readonly searchTimePost: number;
	/** Paste block size — one weight is computed per pasteBlockSize×pasteBlockSize region (4). */
	readonly pasteBlockSize: number;
	/** Smoothing threshold h in W = exp(-||v - v'||² / h²). Scaled from user artifactSmoothing. */
	readonly threshold: number;
}

/**
 * Apply 2D Non-Local Means smoothing to a flat, frame-major gain mask.
 *
 * The mask layout is frame-major: mask[frame * numBins + bin].
 *
 * For each 4×4 paste block, a single weight is computed against every
 * candidate position in the search range (±searchFreqRadius bins in frequency,
 * [−searchTimePre … +searchTimePost] frames in time). Weights use the patch
 * similarity between the 8×8 window centred at the paste-block position and
 * the 8×8 window centred at the candidate position:
 *
 *   W(n, k, dn, dk) = exp(-||v(n,k) − v(n+dn, k+dk)||² / h²)
 *
 * Weights are normalised to sum to 1 before the weighted average is computed,
 * then the same averaged value is written to every cell in the 4×4 output block.
 * Boundary indices are clamped (no wrap-around).
 *
 * @param mask      - Input gain mask, numFrames × numBins, flat row-major (frame-major).
 * @param numFrames - Number of STFT frames.
 * @param numBins   - Number of frequency bins per frame.
 * @param nlmOptions - NLM algorithm parameters (see NlmParams).
 * @param output     - Pre-allocated output array, same shape as mask.
 *
 * @see Lukin, A. & Todd, J. (2007). "Suppression of Musical Noise Artifacts
 *   in Audio Noise Reduction by Adaptive 2D Filtering." 123rd AES Convention,
 *   Paper 7168. PDF: http://imaging.cs.msu.ru/pub/MusicalNoise07.pdf
 * @see Buades, A., Coll, B., Morel, J. (2005). "Image Denoising By Non-Local
 *   Averaging." IEEE ICASSP 2005, vol. 2, pp. 25–28.
 */
export function applyNlmSmoothing(
	mask: Float32Array,
	numFrames: number,
	numBins: number,
	nlmOptions: NlmParams,
	output: Float32Array,
): void {
	const { patchSize, searchFreqRadius, searchTimePre, searchTimePost, pasteBlockSize, threshold } = nlmOptions;
	const hSq = threshold * threshold;
	const halfPatch = Math.floor(patchSize / 2);

	// Iterate over paste blocks (step = pasteBlockSize in both dimensions)
	for (let blockFrame = 0; blockFrame < numFrames; blockFrame += pasteBlockSize) {
		for (let blockBin = 0; blockBin < numBins; blockBin += pasteBlockSize) {
			// Centre of this paste block (used for patch similarity)
			const centreFrame = blockFrame + Math.floor(pasteBlockSize / 2);
			const centreBin = blockBin + Math.floor(pasteBlockSize / 2);

			// Accumulate weighted sum and total weight over all candidate positions
			let weightSum = 0;
			let valueSum = 0;

			// Search range: time [centreFrame - searchTimePre, centreFrame + searchTimePost]
			//               freq [centreBin - searchFreqRadius, centreBin + searchFreqRadius]
			const timeStart = centreFrame - searchTimePre;
			const timeEnd = centreFrame + searchTimePost;
			const freqStart = centreBin - searchFreqRadius;
			const freqEnd = centreBin + searchFreqRadius;

			for (let candFrame = timeStart; candFrame <= timeEnd; candFrame++) {
				// Clamp candidate frame to valid range
				const clampedCandFrame = candFrame < 0 ? 0 : candFrame >= numFrames ? numFrames - 1 : candFrame;

				for (let candBin = freqStart; candBin <= freqEnd; candBin++) {
					// Clamp candidate bin to valid range
					const clampedCandBin = candBin < 0 ? 0 : candBin >= numBins ? numBins - 1 : candBin;

					// Compute patch distance ||v(centre) - v(cand)||²
					// v is an 8×8 patch centred at the respective position.
					let patchDistSq = 0;

					for (let pf = -halfPatch; pf < halfPatch; pf++) {
						for (let pb = -halfPatch; pb < halfPatch; pb++) {
							// Centre patch index — clamp to boundary
							const cf = centreFrame + pf;
							const cBin = centreBin + pb;
							const cf2 = cf < 0 ? 0 : cf >= numFrames ? numFrames - 1 : cf;
							const cBin2 = cBin < 0 ? 0 : cBin >= numBins ? numBins - 1 : cBin;
							const vCentre = mask[cf2 * numBins + cBin2]!;

							// Candidate patch index — clamp to boundary
							const df = clampedCandFrame + pf;
							const db = clampedCandBin + pb;
							const df2 = df < 0 ? 0 : df >= numFrames ? numFrames - 1 : df;
							const db2 = db < 0 ? 0 : db >= numBins ? numBins - 1 : db;
							const vCand = mask[df2 * numBins + db2]!;

							const diff = vCentre - vCand;

							patchDistSq += diff * diff;
						}
					}

					// Weight W = exp(-||v - v'||² / h²)
					const weight = hSq > 0 ? Math.exp(-patchDistSq / hSq) : patchDistSq === 0 ? 1 : 0;

					weightSum += weight;

					// Value at candidate centre position
					valueSum += weight * mask[clampedCandFrame * numBins + clampedCandBin]!;
				}
			}

			// Normalised weighted average for this paste block
			const smoothed = weightSum > 0 ? valueSum / weightSum : mask[centreFrame * numBins + centreBin]!;

			// Write the smoothed value to every cell in the 4×4 paste block
			for (let pf = 0; pf < pasteBlockSize; pf++) {
				const outFrame = blockFrame + pf;

				if (outFrame >= numFrames) break;

				for (let pb = 0; pb < pasteBlockSize; pb++) {
					const outBin = blockBin + pb;

					if (outBin >= numBins) break;

					output[outFrame * numBins + outBin] = smoothed;
				}
			}
		}
	}
}
