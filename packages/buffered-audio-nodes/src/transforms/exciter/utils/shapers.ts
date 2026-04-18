/**
 * Nonlinear transfer curves for the Exciter node.
 *
 * Each shaper is a pure function mapping one sample value to an output value.
 * This module is intentionally isolated — Phase 4 will wrap these functions
 * with oversampling to reduce aliasing.
 *
 * All shapers are designed for input signals in the normalized [-1, 1] range,
 * though they will not produce NaN or Infinity outside that range.
 */

export type ExciterMode = "soft" | "tube" | "fold";

/**
 * Soft saturation: y = x / (1 + |x|)
 *
 * Smooth, asymptotically bounded saturation. Gain decreases gradually for
 * large inputs. Output is always within (-1, 1).
 */
export function softShaper(sample: number): number {
	return sample / (1 + Math.abs(sample));
}

/**
 * Tube-style saturation: y = x * (1.5 - 0.5 * x²) for |x| ≤ 1, clamped otherwise.
 *
 * Mimics the subtle second-harmonic character of triode tubes by applying a
 * cubic polynomial that saturates softly below clipping. Hard-clips at ±1.
 */
export function tubeShaper(sample: number): number {
	if (sample >= 1) return 1;
	if (sample <= -1) return -1;

	return sample * (1.5 - 0.5 * sample * sample);
}

/**
 * Wave folding: y = sin(x * π/2)
 *
 * Wraps the signal back on itself when it exceeds the shaper's natural range,
 * producing rich upper harmonic content with a distinctive folded texture.
 */
export function foldShaper(sample: number): number {
	return Math.sin(sample * (Math.PI / 2));
}

/**
 * Dispatch to the appropriate shaper by mode name.
 */
export function applyShaper(sample: number, mode: ExciterMode): number {
	switch (mode) {
		case "soft":
			return softShaper(sample);
		case "tube":
			return tubeShaper(sample);
		case "fold":
			return foldShaper(sample);
	}
}
