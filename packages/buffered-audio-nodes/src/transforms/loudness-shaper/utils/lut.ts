/**
 * Sparse 32-bit float lookup table for the loudnessShaper transfer
 * function, with linear interpolation between adaptively-spaced points.
 *
 * Per design-loudness-shaper §"LUT realisation".
 *
 * Shape:
 *
 *   Single signed-application LUT with two paired key/value tables —
 *   `posKeys` / `posValues` covering `|x|` for x > 0 and `negKeys` /
 *   `negValues` covering `|x|` for x < 0. At warmth = 0 the node passes
 *   identical pos/neg params and the two tables hold identical values; at
 *   warmth > 0 they differ by per-side `peak` anchors. This keeps lookup
 *   branchless on a sign check and avoids a separate "is symmetric" flag.
 *
 * Sampling layout (per side, by region):
 *
 *   [0, floor]            : 2 keys (0 and floor) — flat at 0 (pass-through)
 *   [floor, bodyLow]      : cosine-spaced N/4 keys — ramp 0 → 1
 *   [bodyLow, bodyHigh]   : 2 keys — flat at 1 (uniform body lift)
 *   [bodyHigh, peak]      : cosine-spaced N/4 keys — ramp 1 → 0  (peak !== null)
 *   [peak, UPPER_LIMIT]   : 2 keys — flat at 0 (pass-through above peak; peak !== null)
 *   [bodyHigh, UPPER_LIMIT] : 2 keys (bodyHigh and UPPER_LIMIT) — flat at full boost (peak === null)
 *
 *   Cosine spacing — `u_k = (1 - cos(π k / N)) / 2` for k ∈ [0, N] —
 *   places points at both u-endpoints exactly and clusters quadratically
 *   toward both. Within a smootherstep ramp the curvature is highest
 *   near the segment midpoint, which the cosine layout still resolves
 *   well; near the endpoints the analytic shape derivative is zero so
 *   coarser sampling is fine. (Cosine spacing was originally chosen for
 *   the prior `u^density` regime where corner curvature was unbounded
 *   — it survives the refactor as a deliberate convention because the
 *   current ramps are still where all interesting curvature lives.)
 *
 * `UPPER_LIMIT` is fixed at `1.0`. In the 32-bit float chain that's the
 * notional sample-magnitude ceiling; samples beyond it are uncommon
 * enough that pass-through above 1.0 (handled by `lookupLUT`) is fine.
 */

import { type CurveParams, f } from "./curve";

/**
 * Upper limit for LUT key coverage. 1.0 is the notional 32-bit float
 * sample-magnitude ceiling. The LUT extends to here so that
 * preservePeaks=false sources, whose body-lifted output may exceed
 * the source peak, remain in tabulated range. For inputs above this
 * limit, `lookupLUT` returns `x` (pass-through).
 */
const LUT_UPPER_LIMIT = 1.0;

export interface LUT {
	/** Positive-side keys, monotonic ascending from 0. */
	posKeys: Float32Array;
	/** Positive-side `f(|x|)` values at each `posKeys[i]`. */
	posValues: Float32Array;
	/** Negative-side keys (|x| domain), monotonic ascending from 0. */
	negKeys: Float32Array;
	/** Negative-side `|f(-|x|)|` values at each `negKeys[i]`. */
	negValues: Float32Array;
}

/**
 * Build a paired-side sparse LUT from the curve.
 *
 * `posParams` covers x >= 0; `negParams` covers x < 0. Pass the same
 * params for both sides when warmth = 0. `boost` is the design-doc's
 * `B`. `pointCountTarget` controls the cosine-sampled ramp density —
 * each ramp gets `pointCountTarget / 4` cosine-spaced samples; the
 * pass-through and flat-body regions get 2 keys each (the segment
 * boundaries).
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
	const sideParams = sign > 0 ? posParams : negParams;
	const { floor, bodyLow, bodyHigh, peak } = sideParams;

	// Cosine-sampled ramp length per ramp segment.
	const rampSamples = Math.max(2, Math.floor(pointCountTarget / 4));

	const keys: Array<number> = [];
	const values: Array<number> = [];

	const push = (absX: number): void => {
		keys.push(absX);
		values.push(evaluateSide(absX, sign, boost, posParams, negParams));
	};

	// Region 1: [0, floor] — 2 keys (0, floor). Flat at 0 → pass-through.
	push(0);

	if (floor > 0) push(floor);

	// Region 2: [floor, bodyLow] — cosine-spaced ramp 0 → 1.
	// Skip the first sample (k = 0 → absX = floor, already pushed above
	// when floor > 0; if floor === 0 we still want absX = 0 only once).
	if (bodyLow > floor) {
		for (let index = 1; index <= rampSamples; index++) {
			const unit = (1 - Math.cos((Math.PI * index) / rampSamples)) / 2;
			const absX = floor + unit * (bodyLow - floor);

			push(absX);
		}
	}

	// Region 3: [bodyLow, bodyHigh] — 2 keys. Flat at 1.
	// bodyLow already pushed by ramp's k = rampSamples (unit = 1).
	if (bodyHigh > bodyLow) push(bodyHigh);

	if (peak !== null && peak > bodyHigh) {
		// Region 4: [bodyHigh, peak] — cosine-spaced ramp 1 → 0.
		for (let index = 1; index <= rampSamples; index++) {
			const unit = (1 - Math.cos((Math.PI * index) / rampSamples)) / 2;
			const absX = bodyHigh + unit * (peak - bodyHigh);

			push(absX);
		}

		// Region 5: [peak, UPPER_LIMIT] — 2 keys (peak, UPPER_LIMIT). Flat at 0.
		// peak already pushed by ramp's k = rampSamples.
		if (LUT_UPPER_LIMIT > peak) push(LUT_UPPER_LIMIT);
	} else {
		// preservePeaks = false (peak === null) OR degenerate peak <= bodyHigh.
		// Region 4': [bodyHigh, UPPER_LIMIT] — 2 keys. Flat at full boost
		// (when peak === null) or flat at 0 (when degenerate, since shape
		// returns 0 everywhere in that case).
		if (LUT_UPPER_LIMIT > bodyHigh) push(LUT_UPPER_LIMIT);
	}

	return {
		keys: new Float32Array(keys),
		values: new Float32Array(values),
	};
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
 * keys. For inputs above the tabulated range (|x| > top key), returns
 * `x` (pass-through per design); for `x = 0`, returns `0`. Binary search
 * across keys — `O(log n)` per lookup; n is typically in the low hundreds.
 */
export function lookupLUT(lut: LUT, x: number): number {
	if (x === 0) return 0;

	const sign = x > 0 ? 1 : -1;
	const absX = x < 0 ? -x : x;
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
