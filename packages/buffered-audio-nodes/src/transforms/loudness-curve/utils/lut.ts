/**
 * Sparse 32-bit float lookup table for the loudnessCurve transfer
 * function, with linear interpolation between adaptively-spaced points.
 *
 * Per design-loudness-curve §"LUT realisation".
 *
 * Shape (decision authority exercised at Phase 2):
 *
 *   Single signed-application LUT with two paired key/value tables —
 *   `posKeys` / `posValues` covering `|x| ∈ [0, posMax]` (used for x > 0)
 *   and `negKeys` / `negValues` covering `|x| ∈ [0, negMax]` (used for
 *   x < 0). At warmth = 0 callers pass identical pos/neg params and the
 *   two tables hold identical values; at warmth > 0 they differ. This
 *   keeps lookup branchless on a sign check and avoids carrying a
 *   separate "is symmetric" flag.
 *
 * Spacing strategy (decision authority exercised at Phase 2):
 *
 *   Cosine-spaced (Chebyshev-node) sampling in u-space per segment,
 *   `pointCountTarget / 2` points per segment plus the median (kept once
 *   after de-duplication). Total LUT entries ≈ pointCountTarget + 1.
 *   Cosine spacing — `u_k = (1 - cos(π k / N)) / 2` for k ∈ [0, N] —
 *   places points exactly at both u-endpoints (0 and 1) and clusters
 *   them quadratically toward those endpoints. This handles the high-
 *   curvature regime at low density (e.g. `shape(u) = u^0.5` has
 *   unbounded slope at u=0) without exploding the table size, while
 *   still giving full coverage of the smoother middle of each segment.
 *
 *   Uniform-in-u was the first attempt; it fails the 0.001 round-trip
 *   tolerance for density < 1 because `u^density` has unbounded
 *   curvature near `u = 0` for `density < 1`. Cosine spacing meets the
 *   tolerance at pointCountTarget = 512 across density ∈ [0.5, 5] — see
 *   lut.unit.test.ts. If even-more-extreme density regimes ever exceed
 *   tolerance, swap in `u_k = ((k / N) ^ p)` warping with `p = 1/density`
 *   per side without changing this module's external surface.
 */

import { type CurveParams, f } from "./curve";

export interface LUT {
	/** Positive-side keys, monotonic ascending in [0, posMax]. */
	posKeys: Float32Array;
	/** Positive-side `f(|x|)` values at each `posKeys[i]`. */
	posValues: Float32Array;
	/** Negative-side keys (|x| domain), monotonic ascending in [0, negMax]. */
	negKeys: Float32Array;
	/** Negative-side `-f(-|x|) = |f(-|x|)|` values at each `negKeys[i]`. */
	negValues: Float32Array;
}

/**
 * Build a paired-side sparse LUT from the curve.
 *
 * `posParams` covers x >= 0 (built from |x| histogram). `negParams`
 * covers x < 0 (built from negative-half histogram for warmth > 0; pass
 * the same object as posParams for warmth = 0 to get identical sides).
 * `boost` is the design-doc's `B`.
 *
 * `pointCountTarget` is split evenly across the rising and falling
 * segments. Boundary points (0, median, max) are always included.
 */
export function buildLUT(
	posParams: CurveParams,
	negParams: CurveParams,
	boost: number,
	pointCountTarget: number,
): LUT {
	if (!Number.isInteger(pointCountTarget) || pointCountTarget < 4) {
		throw new Error(`buildLUT: pointCountTarget must be an integer >= 4, got ${String(pointCountTarget)}`);
	}

	const { keys: posKeys, values: posValues } = buildSide(posParams, negParams, boost, pointCountTarget, 1);
	const { keys: negKeys, values: negValues } = buildSide(posParams, negParams, boost, pointCountTarget, -1);

	return { posKeys, posValues, negKeys, negValues };
}

interface SideTables {
	keys: Float32Array;
	values: Float32Array;
}

/**
 * Build one side's keys/values. `sign` is +1 for the positive side, -1
 * for the negative side. The negative side keys are `|x|` values; the
 * stored value is `|f(-|x|)|` (i.e. the magnitude of the negative-side
 * curve output, which by symmetry is `f(+|x|)` at warmth = 0).
 */
function buildSide(
	posParams: CurveParams,
	negParams: CurveParams,
	boost: number,
	pointCountTarget: number,
	sign: 1 | -1,
): SideTables {
	const { median, max } = sign > 0 ? posParams : negParams;
	const half = Math.max(1, Math.floor(pointCountTarget / 2));

	// Rising segment 0 -> median: `half + 1` points (including 0 and median).
	// Falling segment median -> max: `half + 1` points (including median and max).
	// Median appears once after de-duplication: total = 2 * half + 1.
	const total = 2 * half + 1;
	const keys = new Float32Array(total);
	const values = new Float32Array(total);

	// Cosine (Chebyshev) spacing in u: u_k = (1 - cos(π k / N)) / 2.
	// Endpoints at k = 0 (u = 0) and k = N (u = 1) are exact; samples
	// cluster quadratically near both.
	for (let index = 0; index <= half; index++) {
		const unit = (1 - Math.cos((Math.PI * index) / half)) / 2;
		const absX = unit * median;

		keys[index] = absX;
		values[index] = evaluateSide(absX, sign, boost, posParams, negParams);
	}

	for (let index = 1; index <= half; index++) {
		const unit = (1 - Math.cos((Math.PI * index) / half)) / 2;
		const absX = median + unit * (max - median);
		const target = half + index;

		keys[target] = absX;
		values[target] = evaluateSide(absX, sign, boost, posParams, negParams);
	}

	return { keys, values };
}

/**
 * Evaluate `|f(sign * absX)|` directly via the curve function. Returning
 * the unsigned magnitude keeps both sides' LUT values non-negative and
 * lets `lookupLUT` reapply the sign at the end without branching on
 * stored sign.
 */
function evaluateSide(absX: number, sign: 1 | -1, boost: number, posParams: CurveParams, negParams: CurveParams): number {
	const result = f(sign * absX, boost, posParams, negParams);

	return sign > 0 ? result : -result;
}

/**
 * Look up `f(x)` from the LUT with linear interpolation between adjacent
 * keys. For inputs above the tabulated range, returns `x` (pass-through
 * per design); for `x = 0`, returns `0`. Binary search across keys —
 * `O(log n)` per lookup; n is typically in the low hundreds.
 */
export function lookupLUT(lut: LUT, x: number): number {
	if (x === 0) return 0;

	const sign = x > 0 ? 1 : -1;
	const absX = Math.abs(x);
	const keys = sign > 0 ? lut.posKeys : lut.negKeys;
	const values = sign > 0 ? lut.posValues : lut.negValues;
	const last = keys.length - 1;
	const top = keys[last];

	if (top === undefined || absX >= top) return x;

	// Binary search for the largest index where keys[index] <= absX.
	let low = 0;
	let high = last;

	while (low < high) {
		const mid = (low + high + 1) >>> 1;
		const key = keys[mid];

		if (key !== undefined && key <= absX) low = mid;
		else high = mid - 1;
	}

	const lowerKey = keys[low];
	const upperKey = keys[low + 1];
	const lowerValue = values[low];
	const upperValue = values[low + 1];

	if (lowerKey === undefined || upperKey === undefined || lowerValue === undefined || upperValue === undefined) {
		return x;
	}

	const span = upperKey - lowerKey;
	const fraction = span > 0 ? (absX - lowerKey) / span : 0;
	const magnitude = lowerValue + (upperValue - lowerValue) * fraction;

	return sign > 0 ? magnitude : -magnitude;
}
