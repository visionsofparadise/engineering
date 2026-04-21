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

export type ExciterMode = "soft" | "tube" | "fold" | "tape";

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
 * Tape-style saturation: biased tanh with DC correction.
 *
 * Adds a constant `bias` before the tanh so the transfer curve is asymmetric
 * about zero, producing a second-harmonic-dominant response characteristic of
 * analog tape. The `tanh(bias)` subtraction removes the DC offset the bias
 * would otherwise introduce. The companion HF rolloff (single-pole / biquad
 * lowpass, typically ~12 kHz) lives in `ExciterStream` because it requires
 * per-channel state — this module stays purely stateless to match the
 * existing soft/tube/fold pattern.
 *
 * The caller (ExciterStream) pre-multiplies the signal by the user `drive`
 * factor before invoking the shaper, so dispatch passes `drive = 1` here.
 * The `drive` parameter is kept on the signature so the formula matches the
 * intended `tanh(x * drive + bias) - tanh(bias)` / drive form if a future
 * caller wishes to hand over drive responsibility to the shaper itself.
 */
export function tapeShaper(sample: number, drive: number): number {
	const bias = 0.15;
	const driven = sample * drive + bias;
	const saturated = Math.tanh(driven) - Math.tanh(bias);

	return saturated / drive;
}

/**
 * Dispatch to the appropriate shaper by mode name.
 *
 * For `"tape"`, drive=1 is passed because the caller is expected to have
 * already applied the user drive factor to `sample` (matching the
 * soft/tube/fold convention where drive lives outside the shaper). The HF
 * rolloff that accompanies tape saturation is handled by `ExciterStream`.
 */
export function applyShaper(sample: number, mode: ExciterMode): number {
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
