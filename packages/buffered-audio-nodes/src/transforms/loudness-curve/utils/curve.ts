/**
 * Transfer curve for the loudnessCurve node — triangle-with-power-density
 * shape function plus the signed waveshaper `f`.
 *
 * Per design-loudness-curve §"Transfer curve" / §"Density parameter" /
 * §"Warmth parameter".
 *
 * Anchors: f(0) = 0, f(±median) = ±median × (1 + boost), f(±max) = ±max,
 * pass-through (`f(x) = x`) for `|x| > max`.
 *
 * Warmth call shape (decision authority exercised at Phase 2):
 *
 *   f(x, boost, posParams, negParams)
 *
 * Two explicit `CurveParams` are passed: positive-half (built from the
 * absolute-value histogram) and negative-half (built from the negative-
 * half histogram). At `warmth = 0` callers pass the same params for both
 * sides; at `warmth = 1` they pass the asymmetric pair. Intermediate
 * `warmth` linearly blends the *negative-side shape* between the
 * positive-half params (symmetric reference) and the negative-half params
 * (fully asymmetric reference). The positive side is unaffected by
 * warmth — only the negative side moves.
 *
 * This shape was picked because the LUT builder needs to enumerate
 * positive- and negative-side keys with their own params anyway; option
 * (b) (packing warmth into a single CurveParams plus a side-channel
 * negParams) just adds an indirection without simplifying anything.
 *
 * `boost` is the design-doc's `B` (renamed to satisfy the package's
 * naming-convention rule, which forbids single-letter parameters
 * outside `[xyz]`).
 */

export interface CurveParams {
	/** Median of |x| (positive side) or of negative samples (negative side). > 0. */
	median: number;
	/** Max of |x| (positive side) or of negative samples (negative side). > median. */
	max: number;
	/** Power exponent on the shape function. > 0. */
	density: number;
	/**
	 * Symmetry blend in [0, 1]. Carried on params so callers can supply a
	 * single object covering "this side's histogram-derived numbers plus
	 * the global warmth setting". Only `f` reads it; `shapeAt` is purely
	 * geometric.
	 */
	warmth: number;
}

/**
 * Triangle-with-power-density shape. Returns `0` at the anchors `0` and
 * `max`, `1` at `median`, `(absX / median) ^ density` rising and
 * `((max - absX) / (max - median)) ^ density` falling.
 *
 * For `absX <= 0` or `absX >= max`: returns 0 (covers the pass-through
 * region above max and the trivial zero-input case).
 */
export function shapeAt(absX: number, median: number, max: number, density: number): number {
	if (absX <= 0) return 0;
	if (absX >= max) return 0;

	if (absX <= median) {
		const unit = absX / median;

		return Math.pow(unit, density);
	}

	const unit = (max - absX) / (max - median);

	return Math.pow(unit, density);
}

/**
 * Apply the signed transfer curve at a single sample.
 *
 *   f(x) = sign(x) × |x| × (1 + boost × shape(|x|, params))
 *
 * For `sign(x) >= 0`: shape is computed against `posParams`.
 * For `sign(x) < 0`: shape is `lerp(shapePos, shapeNeg, warmth)` where
 *   - `shapePos = shapeAt(|x|, posParams.median, posParams.max, posParams.density)`
 *   - `shapeNeg = shapeAt(|x|, negParams.median, negParams.max, negParams.density)`
 * `warmth` is read from `posParams.warmth` (the global setting; both
 * params carry the same value in practice).
 *
 * `boost = 0` produces identity (`f(x) = x`). `|x| > max` on the relevant
 * side produces shape = 0 → `f(x) = x` (pass-through above range).
 */
export function f(x: number, boost: number, posParams: CurveParams, negParams: CurveParams): number {
	if (x === 0) return 0;

	const absX = Math.abs(x);
	const sign = x > 0 ? 1 : -1;

	if (sign > 0) {
		const shape = shapeAt(absX, posParams.median, posParams.max, posParams.density);

		return absX * (1 + boost * shape);
	}

	const warmth = posParams.warmth;
	const shapePos = shapeAt(absX, posParams.median, posParams.max, posParams.density);
	const shapeNeg = shapeAt(absX, negParams.median, negParams.max, negParams.density);
	const shape = shapePos + (shapeNeg - shapePos) * warmth;

	return -absX * (1 + boost * shape);
}
