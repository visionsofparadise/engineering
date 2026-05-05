/**
 * Transfer curve for the loudnessExpander node — single-pivot shape with
 * a linear-default tensioned ramp.
 *
 * Per design-loudness-expander §"Transfer curve — single-pivot shape".
 *
 * Geometry: single-pivot. Below `floor`, `shape = 0` (pass-through).
 * Across `[floor, pivot]`, `shape` rises 0 → 1 via tensionedRamp at
 * `tension`. At and above `pivot`, `shape = 1` (full boost). Contrast
 * with `loudnessShaper`'s trapezoid (floor → bodyLow → bodyHigh → peak):
 * the expander has no peak anchor, no flat body interior, and no upper
 * roll-off. The shape is intentionally minimal.
 *
 * The shape function is C⁰ continuous everywhere. At the default tension
 * (`τ = 1`, linear), the ramp has constant slope — minimum max-gradient,
 * which minimises body-region harmonic content before the gain envelope
 * is smoothed. Users can dial softer corners via `tension > 1` (convex)
 * or `tension < 1` (concave).
 *
 * Anchors:
 *   g_raw(|x| <= floor)  = 1            (lower geometric anchor — pass-through)
 *   g_raw(|x| >= pivot)  = 1 + boost    (full boost above pivot)
 *
 * Apply call shape:
 *
 *   gRaw(absX, boost, curveParams)  →  multiplier
 *
 * The expander's gain is computed off the linked detection signal
 * (`max_c(|x[n,c]|)`), not off per-sample `|x|` — so the call site
 * supplies `absX = detect[n]` and the returned multiplier feeds the
 * smoother before being multiplied onto each channel's samples. There
 * is no signed `f(x)` analogue here because the gain is applied as a
 * scalar envelope, not per-sample-signed.
 *
 * `boost` is the design-doc's `B` (renamed to satisfy the package's
 * naming-convention rule, which forbids single-letter parameters
 * outside `[xyz]`).
 *
 * The `tensionedRamp` helper is inlined here rather than imported from
 * `loudness-shaper/utils/curve.ts`. The two `curve.ts` modules are
 * conceptually independent (different shapes); the shared concept is
 * documented at the design level.
 */

export interface CurveParams {
	/** Lower geometric anchor (linear amplitude). Below: shape = 0 → pass-through. >= 0. */
	floor: number;
	/** Upper geometric anchor (linear amplitude). At and above: shape = 1 → full boost. > floor. */
	pivot: number;
	/**
	 * Superellipse tension on the floor → pivot ramp. `τ ∈ (0, ∞)`.
	 * `1` = linear (default; minimum max-gradient across the ramp).
	 * `> 1` = convex (bows above the diagonal; endpoints touch bounding
	 * axes tangentially). `< 1` = concave (mirror across y = x).
	 *
	 * See design-loudness-expander §"Transfer curve" and
	 * design-loudness-shaper §"Transfer curve" for the superellipse math.
	 */
	tension: number;
}

/**
 * Superellipse-family tensioned ramp. Maps `[0, 1] → [0, 1]` with
 * `tensionedRamp(0, τ) = 0` and `tensionedRamp(1, τ) = 1` for all τ > 0.
 *
 * Mirrors the post-tension-revert form in
 * `loudness-shaper/utils/curve.ts` exactly — kept inline here to avoid
 * cross-transform coupling.
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
 * Single-pivot shape function over `|x|`. Returns 0 below floor, ramps
 * 0 → 1 via tensionedRamp(·, tension) across [floor, pivot], then
 * returns 1 at and above pivot.
 *
 * Degenerate guard (returns 0 everywhere — pass-through):
 *   - `pivot <= floor` (no rising-side range)
 */
export function shapeAt(absX: number, curveParams: CurveParams): number {
	const { floor, pivot, tension } = curveParams;

	if (pivot <= floor) return 0;

	if (absX <= floor) return 0;
	if (absX >= pivot) return 1;

	const unit = (absX - floor) / (pivot - floor);

	return tensionedRamp(unit, tension);
}

/**
 * Raw gain multiplier at a single detection-envelope value.
 *
 *   gRaw(absX) = 1 + boost × shape(absX, curveParams)
 *
 * `boost = 0` produces unity (`gRaw = 1`) — no lift. `absX <= floor`
 * produces shape = 0 → `gRaw = 1` (pass-through anchored region).
 * `absX >= pivot` produces shape = 1 → `gRaw = 1 + boost` (full boost).
 *
 * The runtime apply multiplies this with `x` (per channel) — not via a
 * memoryless `f(x)` like the shaper, because the expander's gain is
 * computed off the linked detection signal `max_c(|x[n,c]|)` and then
 * smoothed by a bidirectional IIR before being applied as a scalar
 * envelope across all channels.
 */
export function gRaw(absX: number, boost: number, curveParams: CurveParams): number {
	return 1 + boost * shapeAt(absX, curveParams);
}
