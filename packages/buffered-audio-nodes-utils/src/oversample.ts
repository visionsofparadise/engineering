/**
 * Fixed-factor oversampling for nonlinear DSP stages.
 *
 * This module is NOT a general sample-rate converter. It is a stateful
 * upsample/downsample primitive intended for nonlinear DSP stages
 * (saturation, limiting, true-peak detection) that need a higher internal
 * sample rate to reduce aliasing artifacts or to recover inter-sample peaks.
 *
 * Supported factors: 1, 2, 4, and 8. Factor 1 is a valid pass-through — no
 * LP filtering, no rate change. Factors 2/4/8 perform real oversampling.
 *
 * Primary operations:
 *   - `upsample(input)`: zero-insertion + LP filter. Output length = input * factor.
 *   - `downsample(input)`: LP filter + decimation. Output length = input / factor.
 *   - `oversample(input, fn)`: upsample, apply `fn` per sample, downsample.
 *
 * Anti-aliasing is achieved with a biquad lowpass at 0.45 * sampleRate.
 * The filter states persist across calls for chunk-continuous operation.
 * Two independent biquad states are maintained: one for upsampling, one for
 * downsampling. Keeping them separate prevents cross-coupling between the
 * interpolation smoothing path and the alias-rejection path.
 *
 * Design goal: aliasing reduction / true-peak recovery for practical audio
 * DSP. Not broadcast-quality resampling. Simple zero-insertion + biquad
 * anti-alias is sufficient.
 */

import { lowPassCoefficients } from "./biquad";

export type OversamplingFactor = 1 | 2 | 4 | 8;

/**
 * Per-instance biquad filter state (direct form II transposed).
 * Two delay elements per biquad.
 */
interface BiquadState {
	s1: number;
	s2: number;
}

function makeBiquadState(): BiquadState {
	return { s1: 0, s2: 0 };
}

/**
 * Run a single sample through a biquad, mutating state in place.
 * Uses direct form II transposed, which is numerically more stable
 * than direct form I for audio work.
 *
 * Coefficients follow the standard convention:
 *   fb = [b0, b1, b2]  (numerator)
 *   fa = [1,  a1, a2]  (denominator, a[0] must be 1)
 */
function biquadSample(sample: number, fb: [number, number, number], fa: [number, number, number], state: BiquadState): number {
	const y = fb[0] * sample + state.s1;

	state.s1 = fb[1] * sample - fa[1] * y + state.s2;
	state.s2 = fb[2] * sample - fa[2] * y;

	return y;
}

/**
 * Stateful oversampler for a single audio channel.
 *
 * Factor 1 is a valid pass-through. `upsample` and `downsample` return a
 * fresh copy of the input (callers always receive a new buffer regardless of
 * factor). `oversample(input, fn)` returns a fresh buffer with `fn` applied
 * per sample. No filter state is touched at factor 1.
 *
 * Factors 2/4/8 perform real oversampling with independent up and down
 * biquad LP states maintained across calls.
 */
export class Oversampler {
	/** The oversampling factor this instance was constructed with (1/2/4/8). */
	readonly factor: OversamplingFactor;
	private readonly fb: [number, number, number];
	private readonly fa: [number, number, number];
	private upState: BiquadState;
	private downState: BiquadState;

	constructor(factor: OversamplingFactor, sampleRate: number) {
		this.factor = factor;
		this.upState = makeBiquadState();
		this.downState = makeBiquadState();

		if (factor === 1) {
			// Coefficients are unused at factor 1. Populate with identity-like
			// values so the fields stay readonly-safe.
			this.fb = [1, 0, 0];
			this.fa = [1, 0, 0];

			return;
		}

		// Anti-aliasing cutoff: 0.45 * sampleRate for a gentle roll-off below
		// the original Nyquist. Computed at the oversampled rate so the filter
		// frequency is relative to the expanded bandwidth.
		const cutoffHz = sampleRate * 0.45;
		const oversampledRate = sampleRate * factor;
		const coeffs = lowPassCoefficients(oversampledRate, cutoffHz);

		this.fb = coeffs.fb;
		this.fa = coeffs.fa;
	}

	/**
	 * Zero-insertion upsample + LP filter. Output length = input.length * factor.
	 *
	 * At factor 1 returns a copy of the input (no state change, no filtering).
	 * Callers always receive a fresh buffer.
	 */
	upsample(input: Float32Array): Float32Array {
		if (this.factor === 1) return input.slice();

		const factor = this.factor;
		const inputLength = input.length;
		const upLength = inputLength * factor;
		const upsampled = new Float32Array(upLength);

		// Zero-insertion: place each input sample at stride `factor`, scaled by
		// `factor` so the LP filter preserves amplitude. In-between positions
		// stay at zero from allocation.
		for (let index = 0; index < inputLength; index++) {
			upsampled[index * factor] = (input[index] ?? 0) * factor;
		}

		// LP filter in place to interpolate the zeros into smooth intermediate
		// samples.
		for (let index = 0; index < upLength; index++) {
			upsampled[index] = biquadSample(upsampled[index] ?? 0, this.fb, this.fa, this.upState);
		}

		return upsampled;
	}

	/**
	 * LP filter + decimate. Output length = input.length / factor.
	 *
	 * At factor 1 returns a copy of the input (no state change, no filtering).
	 * Callers always receive a fresh buffer.
	 */
	downsample(input: Float32Array): Float32Array {
		if (this.factor === 1) return input.slice();

		const factor = this.factor;
		const inputLength = input.length;
		const outLength = Math.floor(inputLength / factor);
		const output = new Float32Array(outLength);

		for (let index = 0; index < inputLength; index++) {
			const filtered = biquadSample(input[index] ?? 0, this.fb, this.fa, this.downState);

			if (index % factor === 0) {
				const outIdx = index / factor;

				if (outIdx < outLength) output[outIdx] = filtered;
			}
		}

		return output;
	}

	/**
	 * Upsample, apply `processSample` per oversampled sample, then downsample.
	 * Convenience composition of `upsample` and `downsample`.
	 *
	 * Output length = input.length (at any factor).
	 */
	oversample(input: Float32Array, callback: (x: number) => number): Float32Array {
		const up = this.upsample(input);

		for (let index = 0; index < up.length; index++) {
			up[index] = callback(up[index] ?? 0);
		}

		return this.downsample(up);
	}

	/**
	 * Reset both biquad states to zero. Use when starting a new render /
	 * stream to avoid state bleed. At factor 1 this is a no-op but is safe
	 * to call.
	 */
	reset(): void {
		this.upState.s1 = 0;
		this.upState.s2 = 0;
		this.downState.s1 = 0;
		this.downState.s2 = 0;
	}
}
