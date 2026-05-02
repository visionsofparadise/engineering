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
 * Anti-aliasing is achieved with a cascade of two biquad lowpass sections
 * at 0.45 * sampleRate, giving a 4th-order Butterworth response (24 dB/oct
 * rolloff with maximally flat passband). This was upgraded from a single
 * biquad (12 dB/oct) to better suppress harmonic-aliasing leak in the
 * 15-20 kHz band that was audible at 4× on nonlinear stages such as the
 * loudness-curve LUT.
 *
 * The cascade uses two 2nd-order sections with Butterworth Q values:
 *   stage 1: Q ≈ 0.5412
 *   stage 2: Q ≈ 1.3066
 * The product of the two sections yields the 4th-order Butterworth
 * magnitude response, -3 dB at the design cutoff with no passband peaking.
 *
 * The filter states persist across calls for chunk-continuous operation.
 * Four independent biquad states are maintained: two for upsampling
 * (stages 1 and 2), two for downsampling. Keeping the up and down paths
 * separate prevents cross-coupling between the interpolation smoothing
 * path and the alias-rejection path.
 *
 * Design goal: aliasing reduction / true-peak recovery for practical audio
 * DSP. Not broadcast-quality resampling. A 4th-order Butterworth AA filter
 * is sufficient for 4× / 8× oversampling stages on audio.
 */

import { lowPassCoefficients } from "./biquad";

export type OversamplingFactor = 1 | 2 | 4 | 8;

/**
 * Butterworth Q values for a 4th-order lowpass realised as a cascade of
 * two 2nd-order sections. Derived from the standard pole-pair angles
 * (3π/8 and π/8 from the imaginary axis) via Q = 1 / (2 cos θ).
 *
 *   Q1 = 1 / (2 cos(3π/8)) ≈ 0.5411961001461969
 *   Q2 = 1 / (2 cos(π/8))  ≈ 1.3065629648763766
 *
 * Cascading two RBJ-cookbook lowpass biquads with these Qs at the same
 * cutoff yields a maximally flat 4th-order Butterworth response.
 */
const BUTTERWORTH_Q_STAGE_1 = 1 / (2 * Math.cos((3 * Math.PI) / 8));
const BUTTERWORTH_Q_STAGE_2 = 1 / (2 * Math.cos(Math.PI / 8));

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
 * 4th-order Butterworth LP states (two cascaded biquads each) maintained
 * across calls.
 */
export class Oversampler {
	/** The oversampling factor this instance was constructed with (1/2/4/8). */
	readonly factor: OversamplingFactor;
	private readonly fb1: [number, number, number];
	private readonly fa1: [number, number, number];
	private readonly fb2: [number, number, number];
	private readonly fa2: [number, number, number];
	private upState1: BiquadState;
	private upState2: BiquadState;
	private downState1: BiquadState;
	private downState2: BiquadState;

	constructor(factor: OversamplingFactor, sampleRate: number) {
		this.factor = factor;
		this.upState1 = makeBiquadState();
		this.upState2 = makeBiquadState();
		this.downState1 = makeBiquadState();
		this.downState2 = makeBiquadState();

		if (factor === 1) {
			// Coefficients are unused at factor 1. Populate with identity-like
			// values so the fields stay readonly-safe.
			this.fb1 = [1, 0, 0];
			this.fa1 = [1, 0, 0];
			this.fb2 = [1, 0, 0];
			this.fa2 = [1, 0, 0];

			return;
		}

		// Anti-aliasing cutoff: 0.45 * sampleRate for a gentle roll-off below
		// the original Nyquist. Computed at the oversampled rate so the filter
		// frequency is relative to the expanded bandwidth.
		const cutoffHz = sampleRate * 0.45;
		const oversampledRate = sampleRate * factor;

		const stage1 = lowPassCoefficients(oversampledRate, cutoffHz, BUTTERWORTH_Q_STAGE_1);
		const stage2 = lowPassCoefficients(oversampledRate, cutoffHz, BUTTERWORTH_Q_STAGE_2);

		this.fb1 = stage1.fb;
		this.fa1 = stage1.fa;
		this.fb2 = stage2.fb;
		this.fa2 = stage2.fa;
	}

	/**
	 * Zero-insertion upsample + 4th-order LP filter. Output length =
	 * input.length * factor.
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

		// Cascade two LP biquads in place to interpolate the zeros into smooth
		// intermediate samples. Each sample is filtered through stage 1 then
		// stage 2 before being written back.
		for (let index = 0; index < upLength; index++) {
			const stage1Out = biquadSample(upsampled[index] ?? 0, this.fb1, this.fa1, this.upState1);

			upsampled[index] = biquadSample(stage1Out, this.fb2, this.fa2, this.upState2);
		}

		return upsampled;
	}

	/**
	 * 4th-order LP filter + decimate. Output length = input.length / factor.
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
			const stage1Out = biquadSample(input[index] ?? 0, this.fb1, this.fa1, this.downState1);
			const filtered = biquadSample(stage1Out, this.fb2, this.fa2, this.downState2);

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
	 * Reset all four biquad states to zero. Use when starting a new render /
	 * stream to avoid state bleed. At factor 1 this is a no-op but is safe
	 * to call.
	 */
	reset(): void {
		this.upState1.s1 = 0;
		this.upState1.s2 = 0;
		this.upState2.s1 = 0;
		this.upState2.s2 = 0;
		this.downState1.s1 = 0;
		this.downState1.s2 = 0;
		this.downState2.s1 = 0;
		this.downState2.s2 = 0;
	}
}
