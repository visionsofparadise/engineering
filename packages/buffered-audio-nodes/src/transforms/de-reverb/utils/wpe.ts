/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */

export function computeBinPowerAndEnergy(
	realT: Float32Array,
	imagT: Float32Array,
	numBins: number,
	numFrames: number,
	powerT: Float32Array,
	binEnergy: Float32Array,
): void {
	const usedSize = numBins * numFrames;

	for (let pos = 0; pos < usedSize; pos++) {
		powerT[pos] = Math.max(realT[pos]! * realT[pos]! + imagT[pos]! * imagT[pos]!, 1e-10);
	}

	for (let bin = 0; bin < numBins; bin++) {
		const offset = bin * numFrames;
		let energy = 0;

		for (let frame = 0; frame < numFrames; frame++) {
			energy += powerT[offset + frame]!;
		}

		binEnergy[bin] = energy;
	}
}

export function applyWpePrediction(
	realT: Float32Array,
	imagT: Float32Array,
	originalPowerT: Float32Array,
	binOffset: number,
	numFrames: number,
	predictionDelay: number,
	filterLen: number,
	filterReal: Float32Array,
	filterImag: Float32Array,
): void {
	for (let frame = predictionDelay + filterLen; frame < numFrames; frame++) {
		let predR = 0;
		let predI = 0;

		for (let tap = 0; tap < filterLen; tap++) {
			const pastOffset = binOffset + frame - predictionDelay - tap - 1;
			const pR = realT[pastOffset]!;
			const pI = imagT[pastOffset]!;

			predR += filterReal[tap]! * pR - filterImag[tap]! * pI;
			predI += filterReal[tap]! * pI + filterImag[tap]! * pR;
		}

		const pos = binOffset + frame;
		const newR = realT[pos]! - predR;
		const newI = imagT[pos]! - predI;

		const newPow = newR * newR + newI * newI;
		const origPow = originalPowerT[pos]!;

		if (newPow > origPow) {
			const scale = Math.sqrt(origPow / newPow);

			realT[pos] = newR * scale;
			imagT[pos] = newI * scale;
		} else {
			realT[pos] = newR;
			imagT[pos] = newI;
		}
	}
}

/**
 * Solve WPE filter for a single bin using transposed (bin-major) flat arrays.
 * binOffset is the starting index into the flat arrays for this bin.
 * Exploits Hermitian symmetry of the correlation matrix — only computes
 * the upper triangle (tap2 >= tap1), then mirrors to the lower half.
 */
export function solveWpeFilter(
	realT: Float32Array,
	imagT: Float32Array,
	powerT: Float32Array,
	binOffset: number,
	numFrames: number,
	predictionDelay: number,
	filterLength: number,
	outReal: Float32Array,
	outImag: Float32Array,
	corrReal: Float32Array,
	corrImag: Float32Array,
	crossReal: Float32Array,
	crossImag: Float32Array,
	arWork: Float32Array,
	aiWork: Float32Array,
	brWork: Float32Array,
	biWork: Float32Array,
): void {
	corrReal.fill(0);
	corrImag.fill(0);
	crossReal.fill(0);
	crossImag.fill(0);

	const filterLen = filterLength;
	const delay = predictionDelay;

	for (let frame = delay + filterLen; frame < numFrames; frame++) {
		const weight = 1 / powerT[binOffset + frame]!;
		const targetR = realT[binOffset + frame]!;
		const targetI = imagT[binOffset + frame]!;

		for (let tap1 = 0; tap1 < filterLen; tap1++) {
			const pastIdx1 = binOffset + frame - delay - tap1 - 1;
			const pR1 = realT[pastIdx1]!;
			const pI1 = imagT[pastIdx1]!;

			crossReal[tap1] = (crossReal[tap1] ?? 0) + weight * (pR1 * targetR + pI1 * targetI);
			crossImag[tap1] = (crossImag[tap1] ?? 0) + weight * (pR1 * targetI - pI1 * targetR);

			// Upper triangle only (Hermitian: corr[i][j] = conj(corr[j][i]))
			for (let tap2 = tap1; tap2 < filterLen; tap2++) {
				const pastIdx2 = binOffset + frame - delay - tap2 - 1;
				const pR2 = realT[pastIdx2]!;
				const pI2 = imagT[pastIdx2]!;

				corrReal[tap1 * filterLen + tap2] = (corrReal[tap1 * filterLen + tap2] ?? 0) + weight * (pR1 * pR2 + pI1 * pI2);
				corrImag[tap1 * filterLen + tap2] = (corrImag[tap1 * filterLen + tap2] ?? 0) + weight * (pR1 * pI2 - pI1 * pR2);
			}
		}
	}

	// Fill lower triangle from conjugate of upper
	for (let tap1 = 1; tap1 < filterLen; tap1++) {
		for (let tap2 = 0; tap2 < tap1; tap2++) {
			corrReal[tap1 * filterLen + tap2] = corrReal[tap2 * filterLen + tap1]!;
			corrImag[tap1 * filterLen + tap2] = -corrImag[tap2 * filterLen + tap1]!;
		}
	}

	// Regularize diagonal
	for (let tap = 0; tap < filterLen; tap++) {
		corrReal[tap * filterLen + tap] = (corrReal[tap * filterLen + tap] ?? 0) + 1e-6;
	}

	solveLinearSystem(corrReal, corrImag, crossReal, crossImag, filterLen, outReal, outImag, arWork, aiWork, brWork, biWork);
}

export function solveLinearSystem(
	aReal: Float32Array,
	aImag: Float32Array,
	bReal: Float32Array,
	bImag: Float32Array,
	size: number,
	outReal: Float32Array,
	outImag: Float32Array,
	ar: Float32Array,
	ai: Float32Array,
	br: Float32Array,
	bi: Float32Array,
): void {
	ar.set(aReal);
	ai.set(aImag);
	br.set(bReal);
	bi.set(bImag);

	for (let col = 0; col < size; col++) {
		// Partial pivoting: find row with largest magnitude in this column
		let maxMag = 0;
		let maxRow = col;

		for (let row = col; row < size; row++) {
			const re = ar[row * size + col] ?? 0;
			const im = ai[row * size + col] ?? 0;
			const mag = re * re + im * im;

			if (mag > maxMag) {
				maxMag = mag;
				maxRow = row;
			}
		}

		if (maxMag < 1e-20) continue;

		// Swap rows
		if (maxRow !== col) {
			for (let sc = col; sc < size; sc++) {
				const tmpR = ar[col * size + sc] ?? 0;
				const tmpI = ai[col * size + sc] ?? 0;

				ar[col * size + sc] = ar[maxRow * size + sc] ?? 0;
				ai[col * size + sc] = ai[maxRow * size + sc] ?? 0;
				ar[maxRow * size + sc] = tmpR;
				ai[maxRow * size + sc] = tmpI;
			}

			const tmpBr = br[col] ?? 0;
			const tmpBi = bi[col] ?? 0;

			br[col] = br[maxRow] ?? 0;
			bi[col] = bi[maxRow] ?? 0;
			br[maxRow] = tmpBr;
			bi[maxRow] = tmpBi;
		}

		// Pivot element
		const pivR = ar[col * size + col] ?? 0;
		const pivI = ai[col * size + col] ?? 0;
		const pivMag2 = pivR * pivR + pivI * pivI;

		// Eliminate below pivot
		for (let row = col + 1; row < size; row++) {
			const elemR = ar[row * size + col] ?? 0;
			const elemI = ai[row * size + col] ?? 0;

			// factor = elem / pivot (complex division)
			const factR = (elemR * pivR + elemI * pivI) / pivMag2;
			const factI = (elemI * pivR - elemR * pivI) / pivMag2;

			for (let ec = col + 1; ec < size; ec++) {
				const ajR = ar[col * size + ec] ?? 0;
				const ajI = ai[col * size + ec] ?? 0;

				ar[row * size + ec] = (ar[row * size + ec] ?? 0) - (factR * ajR - factI * ajI);
				ai[row * size + ec] = (ai[row * size + ec] ?? 0) - (factR * ajI + factI * ajR);
			}

			br[row] = (br[row] ?? 0) - (factR * (br[col] ?? 0) - factI * (bi[col] ?? 0));
			bi[row] = (bi[row] ?? 0) - (factR * (bi[col] ?? 0) + factI * (br[col] ?? 0));

			ar[row * size + col] = 0;
			ai[row * size + col] = 0;
		}
	}

	// Back-substitution
	for (let row = size - 1; row >= 0; row--) {
		let sumR = br[row] ?? 0;
		let sumI = bi[row] ?? 0;

		for (let bc = row + 1; bc < size; bc++) {
			const ajR = ar[row * size + bc] ?? 0;
			const ajI = ai[row * size + bc] ?? 0;
			const xjR = outReal[bc] ?? 0;
			const xjI = outImag[bc] ?? 0;

			sumR -= ajR * xjR - ajI * xjI;
			sumI -= ajR * xjI + ajI * xjR;
		}

		const diagR = ar[row * size + row] ?? 0;
		const diagI = ai[row * size + row] ?? 0;
		const diagMag2 = diagR * diagR + diagI * diagI;

		if (diagMag2 > 1e-20) {
			outReal[row] = (sumR * diagR + sumI * diagI) / diagMag2;
			outImag[row] = (sumI * diagR - sumR * diagI) / diagMag2;
		}
	}
}
