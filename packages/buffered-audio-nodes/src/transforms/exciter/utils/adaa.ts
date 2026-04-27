/**
 * First-order antiderivative antialiasing (ADAA) for the four exciter shapers.
 *
 * Grounding: Parker, J. D., Zavalishin, V., Le Bivic, E. (2016), "Reducing the
 * Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution",
 * DAFx-16, pp. 137–144. See §2.2 Eq. 9 for the rectangular-kernel rule, §2.3
 * Eq. 10 for the ill-conditioning substitute, §4 Eq. 17 for the low-signal
 * half-sample delay, §5.1 Eq. 20 for the tanh antiderivative, §5.2 Eq. 25 for
 * the hard-clip antiderivative.
 *
 * The rule is:
 *
 *     y[n] = (F0(x_n) − F0(x_{n-1})) / (x_n − x_{n-1})        (Eq. 9)
 *
 * and when |x_n − x_{n-1}| falls below ADAA_EPS, we fall back to
 *
 *     y[n] = f((x_n + x_{n-1}) / 2)                           (Eq. 10)
 *
 * All four F0 functions here are pinned to F0(0) = 0 per Parker-Zavalishin
 * §2.3 so that the numerator's loss-of-precision at small Δx is minimised.
 *
 * Derivation notes per curve (verified 2026-04-22 numerically by
 * differentiating F0 on x ∈ [-10, 10] and comparing against the pointwise
 * shaper; see `unit.test.ts`):
 *
 *   - soft: f(x) = x / (1 + |x|).
 *     F0(x) = |x| − ln(1 + |x|). The antiderivative is *even* (integral of an
 *     odd function is even); an earlier draft used sgn(x)·(|x| − ln(1+|x|)),
 *     which is the odd extension and differentiates to +|f(x)| on the
 *     negative branch — wrong. See design-exciter.md.
 *
 *   - tube: f(x) = x·(1.5 − 0.5·x²) for |x| ≤ 1, clamped to sgn(x) otherwise.
 *     F0(x) = 0.75·x² − 0.125·x⁴ for |x| ≤ 1;
 *     F0(x) = |x| − 0.375 for |x| > 1 (continuity at |x|=1: both branches
 *     give 0.625).
 *
 *   - fold: f(x) = sin(x·π/2).
 *     F0(x) = (2/π)·(1 − cos(x·π/2)).
 *
 *   - tape: f(x) = tanh(x + bias) − tanh(bias) with bias = 0.15. The exciter
 *     applies the user `drive` upstream and invokes the shaper with drive=1,
 *     so the ADAA boundary sees `tanh(x + b) − tanh(b)`.
 *     F0(x) = ln(cosh(x + bias)) − tanh(bias)·x − ln(cosh(bias)).
 *     The Parker-Zavalishin §5.1 tabulation guidance targets the F1 form
 *     (Eq. 22) used with the triangular kernel, not this F0, which is cheap
 *     enough to evaluate directly.
 *
 * The ADAA rule introduces a half-sample group delay at low signal levels
 * (Parker-Zavalishin §4 Eq. 17) — that is a linear-phase fractional-delay
 * property of the method, not an implementation artefact. The caller
 * latency-compensates the dry path in `index.ts`.
 */

import { softShaper, tubeShaper, foldShaper, tapeShaper, type ExciterMode } from "./shapers";

/**
 * Threshold on |x_n − x_{n-1}| below which the ADAA rule is ill-conditioned
 * and we fall back to Parker-Zavalishin §2.3 Eq. 10.
 *
 * The paper does not pin a single numeric; the right value depends on float
 * precision and on the shaper's local smoothness. For Float32 audio
 * (~7-digit precision), 1e-5 keeps the subtraction well away from the
 * catastrophic-cancellation regime while incurring an O((Δx)²) ≲ 1e-10
 * error in the fallback, far below the perceptual floor. Float64 paths
 * would use 1e-10; the exciter runs on Float32 buffers, so 1e-5 is the
 * shipped constant.
 */
export const ADAA_EPS = 1e-5;

const TAPE_BIAS = 0.15;
/**
 * Precomputed tanh(bias) and ln(cosh(bias)) so every sample doesn't redo
 * them. These are constants for the life of the module.
 */
const TAPE_TANH_BIAS = Math.tanh(TAPE_BIAS);
const TAPE_LOG_COSH_BIAS = Math.log(Math.cosh(TAPE_BIAS));

/** First antiderivative of `softShaper`, pinned so F0_soft(0) = 0. */
export function F0Soft(x: number): number {
	const absX = Math.abs(x);

	return absX - Math.log1p(absX);
}

/** First antiderivative of `tubeShaper`, pinned so F0_tube(0) = 0. */
export function F0Tube(x: number): number {
	const absX = Math.abs(x);

	if (absX <= 1) {
		const x2 = x * x;

		return 0.75 * x2 - 0.125 * x2 * x2;
	}

	return absX - 0.375;
}

/** First antiderivative of `foldShaper`, pinned so F0_fold(0) = 0. */
export function F0Fold(x: number): number {
	return (2 / Math.PI) * (1 - Math.cos(x * (Math.PI / 2)));
}

/** First antiderivative of `tapeShaper(·, 1)`, pinned so F0_tape(0) = 0. */
export function F0Tape(x: number): number {
	return Math.log(Math.cosh(x + TAPE_BIAS)) - TAPE_TANH_BIAS * x - TAPE_LOG_COSH_BIAS;
}

/** Dispatch to F0_<mode>(x). */
function antiderivative(sample: number, mode: ExciterMode): number {
	switch (mode) {
		case "soft":
			return F0Soft(sample);
		case "tube":
			return F0Tube(sample);
		case "fold":
			return F0Fold(sample);
		case "tape":
			return F0Tape(sample);
	}
}

/** Pointwise shaper dispatch — reused for the Eq. 10 ill-conditioned fallback. */
function shaper(sample: number, mode: ExciterMode): number {
	switch (mode) {
		case "soft":
			return softShaper(sample);
		case "tube":
			return tubeShaper(sample);
		case "fold":
			return foldShaper(sample);
		case "tape":
			return tapeShaper(sample, 1);
	}
}

/**
 * First-order ADAA evaluation of the shaper `mode` given the current sample
 * `x_n` and the previous sample `x_{n-1}`.
 *
 * Per Parker-Zavalishin §2.3, when |x_n − x_{n-1}| < ADAA_EPS we fall back
 * to `f((x_n + x_{n-1}) / 2)` to avoid the 0/0 catastrophic cancellation.
 */
export function adaaShaper(currentSample: number, previousSample: number, mode: ExciterMode): number {
	const delta = currentSample - previousSample;

	if (Math.abs(delta) < ADAA_EPS) {
		return shaper(0.5 * (currentSample + previousSample), mode);
	}

	return (antiderivative(currentSample, mode) - antiderivative(previousSample, mode)) / delta;
}

/**
 * Stateful ADAA callback interface.
 *
 * The callback is a unary function suitable for `Oversampler.oversample`; it
 * also exposes a `setMode` mutator that swaps the dispatch curve without
 * disturbing the internal `x_{n-1}` register.
 *
 * Mode changes mid-stream must not reset `x_{n-1}`: resetting it makes the
 * first post-switch sample evaluate as
 * `(F0_new(x_n) − F0_new(0)) / x_n` instead of the smooth
 * `(F0_new(x_n) − F0_new(x_{n-1})) / (x_n − x_{n-1})`, which is a
 * spurious discontinuity in its own right. The sample value `x_{n-1}` is a
 * real previous input and remains a valid reference point for the new F0 —
 * the discontinuity inherent to a mid-stream curve swap is in which F0 is
 * evaluated, not in the prev-sample register.
 */
export interface AdaaCallback {
	(sample: number): number;
	setMode(mode: ExciterMode): void;
}

/**
 * Build a stateful ADAA callback for `Oversampler.oversample`.
 *
 * The returned callback captures a single `previousSample` register that
 * persists across every invocation — both within a single `oversample()`
 * run and across subsequent runs on the same channel. This is what makes
 * the ADAA rule chunk-continuous: the first sample of chunk N+1 sees the
 * last sample of chunk N as its `x_{n-1}`.
 *
 * Calling `setMode` swaps the dispatch curve without touching
 * `previousSample`, preserving chunk continuity across mode changes.
 *
 * Use one `makeAdaaCallback` per channel; do not share callbacks across
 * channels.
 */
export function makeAdaaCallback(initialMode: ExciterMode): AdaaCallback {
	let previousSample = 0;
	let currentMode: ExciterMode = initialMode;

	const callback = ((sample: number): number => {
		const result = adaaShaper(sample, previousSample, currentMode);

		previousSample = sample;

		return result;
	}) as AdaaCallback;

	callback.setMode = (mode: ExciterMode): void => {
		currentMode = mode;
	};

	return callback;
}
