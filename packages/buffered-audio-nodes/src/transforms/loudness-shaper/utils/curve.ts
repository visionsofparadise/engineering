/**
 * Transfer curve for the loudnessShaper node — trapezoidal shape with
 * linear-default tensioned ramps plus the signed waveshaper `f`.
 *
 * Per design-loudness-shaper §"Transfer curve" (2026-05-05 decision:
 * "Linear-default ramps with per-ramp superellipse tension; smootherstep
 * removed").
 *
 * Geometry: trapezoidal. Below `floor`, `shape = 0` (pass-through).
 * Across `[floor, bodyLow]`, `shape` rises 0 → 1 via tensionedRamp at
 * `tensionLow`. Across `[bodyLow, bodyHigh]`, `shape = 1` (uniform body
 * lift). When `peak !== null`, across `[bodyHigh, peak]`, `shape` falls
 * 1 → 0 via tensionedRamp at `tensionHigh`, then `shape = 0` above `peak`
 * (pass-through). When `peak === null` (preservePeaks = false), `shape = 1`
 * everywhere above `bodyLow` — the body lift extends without an upper
 * roll-off.
 *
 * The shape function is C⁰ continuous everywhere. At the default tension
 * (`τ = 1`, linear), each ramp has constant slope — minimum max-gradient,
 * which minimises body-region harmonic distortion. Users can dial softer
 * corners via `tensionLow > 1` / `tensionHigh > 1` (convex; bows above the
 * diagonal with tangential endpoint contact). `τ < 1` produces concave
 * ramps (mirror across `y = x`).
 *
 * Anchors:
 *   f(|x| <= floor) = x                            (lower geometric anchor — pass-through)
 *   f(|x| ∈ [bodyLow, bodyHigh]) = x × (1 + boost) (flat body lift)
 *   f(|x| >= peak) = x   (when peak !== null)      (upper geometric anchor — pass-through)
 *   f(|x| > bodyHigh) = x × (1 + boost)            (when peak === null — body lift continues)
 *
 * Warmth call shape:
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
	/**
	 * Superellipse tension on the floor → bodyLow ramp. `τ ∈ (0, ∞)`.
	 * `1` = linear (default; minimum max-gradient across the ramp).
	 * `> 1` = convex (bows above the diagonal; endpoints touch bounding
	 * axes tangentially). `< 1` = concave (mirror across y = x).
	 *
	 * See design-loudness-shaper §"Transfer curve" and gain-shaper
	 * design-vst §"Transfer" for the superellipse math.
	 */
	tensionLow: number;
	/**
	 * Superellipse tension on the bodyHigh → peak ramp. Same `τ ∈ (0, ∞)`
	 * semantics as `tensionLow`. Silently ignored when `peak === null`
	 * (preservePeaks = false — no upper ramp exists in that mode).
	 */
	tensionHigh: number;
}

/**
 * Superellipse-family tensioned ramp. Maps `[0, 1] → [0, 1]` with
 * `tensionedRamp(0, τ) = 0` and `tensionedRamp(1, τ) = 1` for all τ > 0.
 *
 * The function lives on the standard superellipse / quarter-circle family
 * parameterised on the `0 → 1 → ∞` axis:
 *   - `τ = 1`   → linear (`t`); constant slope; minimum max-gradient.
 *   - `τ > 1`   → convex; bows above the diagonal; endpoints touch
 *                  bounding axes tangentially (C¹ at 0 and 1).
 *   - `τ < 1`   → concave; mirror of `τ > 1` across `y = x`.
 *   - `τ = 2`   → upper-left quarter circle.
 *
 * The default tension in `CurveParams` is `1` (linear). Users dial a
 * softer corner by increasing `τ` above `1`.
 *
 * Per design-loudness-shaper §"Transfer curve" (2026-05-05 decision) and
 * gain-shaper design-vst §"Transfer" (source of the formula).
 *
 *   τ == 1:  return t
 *   τ > 1:   y = (1 − (1 − t)^τ)^(1/τ)
 *   τ < 1:   y = 1 − (1 − t^(1/τ))^τ    (concave; mirror across y = x)
 */
function tensionedRamp(unit: number, tension: number): number {
	if (tension === 1) return unit;
	if (tension > 1) return Math.pow(1 - Math.pow(1 - unit, tension), 1 / tension);

	// tension < 1 — concave; mirror across y = x
	return 1 - Math.pow(1 - Math.pow(unit, 1 / tension), tension);
}

/**
 * Trapezoidal shape function over `|x|`. Returns 0 below floor, ramps
 * 0 → 1 via tensionedRamp(·, tensionLow) across [floor, bodyLow], stays
 * at 1 across [bodyLow, bodyHigh], then either ramps 1 → 0 via
 * tensionedRamp(·, tensionHigh) across [bodyHigh, peak] and returns 0
 * above (when `peak !== null`) or stays at 1 above `bodyHigh` (when
 * `peak === null`).
 *
 * Degenerate guards (return 0 for shape, i.e. pass-through everywhere):
 *   - `bodyLow <= floor` (no rising-side range)
 *   - `peak !== null && peak <= bodyHigh` (no falling-side range)
 */
export function shapeAt(absX: number, sideParams: CurveParams): number {
	const { floor, bodyLow, bodyHigh, peak, tensionLow, tensionHigh } = sideParams;

	if (bodyLow <= floor) return 0;
	if (peak !== null && peak <= bodyHigh) return 0;

	if (absX <= floor) return 0;

	if (absX < bodyLow) {
		const unit = (absX - floor) / (bodyLow - floor);

		return tensionedRamp(unit, tensionLow);
	}

	if (absX <= bodyHigh) return 1;

	if (peak !== null) {
		if (absX >= peak) return 0;

		const unit = (peak - absX) / (peak - bodyHigh);

		return tensionedRamp(unit, tensionHigh);
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
