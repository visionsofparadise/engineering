// γ-percent AR-residual detection for Ruhland 2015 BMRI (§II.B).
//
// Fits an AR(p_det = 32) model on a residual time-domain block via Burg's
// method, computes the per-sample squared prediction error, and flags the
// top-γ-fraction of samples by squared error. The rule is RANK-based —
// Ruhland §II.B is explicit that γ selects a fixed fraction of samples per
// block rather than thresholding `e²[n]` against a Kσ criterion (design-declick
// §Algorithm step 4 reproduces the paper's quote verbatim).
//
// Burg is chosen over Yule-Walker following design-declick §Algorithm step 4:
// minimum-phase stability plus no edge-bias from autocorrelation-method
// windowing. Ruhland §II.B lists both as acceptable; we match G&R §5.2.2's
// reasoning for Burg.
//
// The function returns the coefficients alongside the flagged mask so the
// caller (BMRI per-block LSAR stage) can reuse them for interpolation — the
// detection AR and the interpolation AR are the same model in Ruhland's
// pipeline.

import { arResidual, burgMethod } from "./ar-model";

const MAX_GAMMA_FRACTION = 0.5;

export interface ArResidualDetectionResult {
	readonly flagged: Uint8Array;
	readonly coeffs: Float32Array;
}

/**
 * Detect impulsive samples in a residual time-domain block via the γ-percent
 * AR-residual rank rule (Ruhland §II.B).
 *
 * `gammaFraction` is clamped to `[0, 0.5]`. Ruhland cautions (§II.B) that
 * γ > 50% makes the subsequent LSAR solve ill-posed — the number of unknowns
 * exceeds the number of knowns. `gammaFraction === 0` returns an all-zero
 * mask and does not fit the AR model.
 *
 * Returns `{ flagged, coeffs }` — `flagged[i] = 1` when sample `i` is among
 * the top-γ-fraction by squared AR-residual, else `0`. `coeffs` is the
 * `burgMethod` output.
 */
export function detectArResidual(residualBlock: Float32Array, arOrder: number, gammaFraction: number): ArResidualDetectionResult {
	const length = residualBlock.length;
	const flagged = new Uint8Array(length);

	if (gammaFraction <= 0 || length === 0) {
		return { flagged, coeffs: new Float32Array(arOrder) };
	}

	const clamped = Math.min(gammaFraction, MAX_GAMMA_FRACTION);
	const targetCount = Math.round(clamped * length);

	if (targetCount <= 0) {
		return { flagged, coeffs: new Float32Array(arOrder) };
	}

	// Burg throws on length < order + 1. If the block is too short to fit the
	// AR model (should not happen at L = 2048 with p_det = 32), fall back to
	// zero coefficients so the rank selection runs on squared samples directly.
	let coeffs: Float32Array;

	if (length < arOrder + 1) {
		coeffs = new Float32Array(arOrder);
	} else {
		coeffs = burgMethod(residualBlock, arOrder);
	}

	const residual = arResidual(residualBlock, coeffs);

	// Build an index array sorted by squared residual descending. Full sort is
	// fine at block sizes ~2048; asymptotics don't matter here.
	const squared = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		const e = residual[i] ?? 0;

		squared[i] = e * e;
	}

	const indices = new Int32Array(length);

	for (let i = 0; i < length; i++) indices[i] = i;

	const indexArray = Array.from(indices);

	indexArray.sort((left, right) => (squared[right] ?? 0) - (squared[left] ?? 0));

	const flagCount = Math.min(targetCount, length);

	for (let i = 0; i < flagCount; i++) {
		const idx = indexArray[i] ?? 0;

		flagged[idx] = 1;
	}

	return { flagged, coeffs };
}
