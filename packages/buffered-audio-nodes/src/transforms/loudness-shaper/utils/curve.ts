/**
 * Transfer curve for the loudnessShaper node — trapezoidal shape with
 * smootherstep-ramped corners plus the signed waveshaper `f`.
 *
 * Per design-loudness-shaper §"Transfer curve".
 *
 * Geometry: trapezoidal. Below `floor`, `shape = 0` (pass-through).
 * Across `[floor, bodyLow]`, `shape` rises 0 → 1 via smootherstep.
 * Across `[bodyLow, bodyHigh]`, `shape = 1` (uniform body lift). When
 * `peak !== null`, across `[bodyHigh, peak]`, `shape` falls 1 → 0 via
 * smootherstep, then `shape = 0` above `peak` (pass-through). When
 * `peak === null` (preservePeaks = false), `shape = 1` everywhere above
 * `bodyLow` — the body lift extends without an upper roll-off.
 *
 * The shape function is C² continuous everywhere (smootherstep has zero
 * first and second derivatives at both endpoints), so the waveshaper-
 * induced harmonic content is dominated by the smooth ramp curvature
 * rather than corner sharpness.
 *
 * Anchors:
 *   f(|x| <= floor) = x                            (lower geometric anchor — pass-through)
 *   f(|x| ∈ [bodyLow, bodyHigh]) = x × (1 + boost) (flat body lift)
 *   f(|x| >= peak) = x   (when peak !== null)      (upper geometric anchor — pass-through)
 *   f(|x| > bodyHigh) = x × (1 + boost)            (when peak === null — body lift continues)
 *
 * Warmth call shape (decision authority exercised at Phase 1.10):
 *
 *   f(x, boost, posParams, negParams)
 *
 * Two explicit `CurveParams` are passed: positive-half and negative-half.
 * At `warmth = 0` the node-level wiring passes the same params for both
 * sides; at `warmth > 0` the negative-side `peak` differs from the
 * positive-side `peak` (the only field that varies under the current
 * warmth implementation). `f` itself doesn't read warmth — the asymmetry
 * is fully expressed in the params handed to it.
 *
 * `boost` is the design-doc's `B` (renamed to satisfy the package's
 * naming-convention rule, which forbids single-letter parameters
 * outside `[xyz]`).
 */

export interface CurveParams {
	/** Lower geometric anchor (linear amplitude). Below: shape = 0 → pass-through. >= 0. */
	floor: number;
	/** Low edge of full-boost body region (linear amplitude). > floor. */
	bodyLow: number;
	/** High edge of full-boost body region (linear amplitude). >= bodyLow. */
	bodyHigh: number;
	/**
	 * Upper geometric anchor (linear amplitude). When non-null: shape ramps
	 * down 1 → 0 across `[bodyHigh, peak]`, then `shape = 0` above (pass-
	 * through). When null (preservePeaks = false): no upper roll-off; the
	 * body lift continues at full strength above `bodyHigh`.
	 *
	 * Must be > bodyHigh when non-null.
	 */
	peak: number | null;
}

/**
 * Smootherstep — Ken Perlin's improved smoothstep. C² continuous (zero
 * first AND second derivatives at both endpoints), versus smoothstep's
 * C¹. Cuts harmonic content from corner sharpness by another order of
 * falloff (1/f² → 1/f³) at the cost of a marginally higher peak slope
 * (1.5 → 1.875) at the segment midpoint.
 *
 *   smootherstep(0) = 0, smootherstep(1) = 1
 *   smootherstep'(0) = smootherstep'(1) = 0
 *   smootherstep''(0) = smootherstep''(1) = 0
 *   smootherstep(t) = 6t⁵ − 15t⁴ + 10t³
 *                   = t³ × (t × (t × 6 − 15) + 10)
 */
function smootherstep(unit: number): number {
	return unit * unit * unit * (unit * (unit * 6 - 15) + 10);
}

/**
 * Trapezoidal shape function over `|x|`. Returns 0 below floor, ramps
 * 0 → 1 via smootherstep across [floor, bodyLow], stays at 1 across
 * [bodyLow, bodyHigh], then either ramps 1 → 0 across [bodyHigh, peak]
 * and returns 0 above (when `peak !== null`) or stays at 1 above
 * `bodyHigh` (when `peak === null`).
 *
 * Degenerate guards (return 0 for shape, i.e. pass-through everywhere):
 *   - `bodyLow <= floor` (no rising-side range)
 *   - `peak !== null && peak <= bodyHigh` (no falling-side range)
 */
export function shapeAt(absX: number, sideParams: CurveParams): number {
	const { floor, bodyLow, bodyHigh, peak } = sideParams;

	if (bodyLow <= floor) return 0;
	if (peak !== null && peak <= bodyHigh) return 0;

	if (absX <= floor) return 0;

	if (absX < bodyLow) {
		const unit = (absX - floor) / (bodyLow - floor);

		return smootherstep(unit);
	}

	if (absX <= bodyHigh) return 1;

	if (peak !== null) {
		if (absX >= peak) return 0;

		const unit = (peak - absX) / (peak - bodyHigh);

		return smootherstep(unit);
	}

	// preservePeaks = false (peak === null): body lift continues above bodyHigh.
	return 1;
}

/**
 * Apply the signed transfer curve at a single sample.
 *
 *   f(x) = sign(x) × |x| × (1 + boost × shape(|x|, params))
 *
 * Positive samples use `posParams`; negative samples use `negParams`.
 * Symmetry is explicit at the params level — when `posParams` and
 * `negParams` carry the same values the curve is strictly symmetric
 * (`f(-x) = -f(x)`, odd harmonics only). Asymmetry (warmth > 0) is
 * realised by the caller varying the per-side `peak` value (and
 * potentially other fields in future).
 *
 * `boost = 0` produces identity (`f(x) = x`). `|x| <= floor` and
 * (when `peak !== null`) `|x| >= peak` produce shape = 0 → `f(x) = x`
 * (pass-through anchored regions).
 */
export function f(x: number, boost: number, posParams: CurveParams, negParams: CurveParams): number {
	if (x === 0) return 0;

	const absX = x < 0 ? -x : x;
	const sign = x > 0 ? 1 : -1;
	const shape = sign > 0 ? shapeAt(absX, posParams) : shapeAt(absX, negParams);

	return sign * absX * (1 + boost * shape);
}
