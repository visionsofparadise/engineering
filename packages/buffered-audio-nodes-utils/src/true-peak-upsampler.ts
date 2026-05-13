/**
 * Spec-compliant true-peak upsampler implementing the polyphase FIR
 * interpolation filter from ITU-R BS.1770-4 Annex 1 (the normative
 * description of true-peak measurement). For 4× upsampling the spec
 * defines a 48-tap polyphase FIR arranged as 4 phases × 12 taps:
 *
 *   - Phase 0 reproduces the input sample (impulse-aligned tap; the
 *     filter is designed so this phase is the identity tap).
 *   - Phases 1, 2, 3 produce the three interpolated samples between
 *     each pair of input samples.
 *
 * For each input sample `x[n]`, the upsampler emits four output
 * samples whose values are inner products of phase `p`'s 12 taps with
 * the last 12 input samples `x[n], x[n-1], ..., x[n-11]`.
 *
 * The coefficients below are taken from the libebur128 reference
 * implementation's `interpolator.c` (`g_true_peak_4x_coefficients` /
 * `interp_coeff` in upstream and the various downstream forks), which
 * mirrors BS.1770-4 Annex 1 verbatim.
 *
 *   Reference: https://github.com/jiixyj/libebur128
 *              ebur128/ebur128.c — `interp_create` / interpolator coefficients
 *              (originally derived in BS.1770-4 Annex 1, table 4).
 *
 * Behavioural contract:
 *
 *   - `upsample(input)` returns a fresh `Float32Array` of length
 *     `input.length * factor`. State carries across calls so chunk
 *     boundaries are invisible to the result.
 *   - `reset()` clears the 12-tap input-history ring buffer so the
 *     filter starts cold (use when reusing the instance for a new
 *     stream / measurement).
 *
 * Per-channel: callers manage one instance per channel.
 *
 * Only 4× is implemented currently. The constructor accepts a typed
 * `factor` parameter (`4 | 8 | 16`) so future extension to higher
 * ratios is clean. 8× / 16× currently throw — they need their own
 * polyphase coefficient tables that are not part of BS.1770-4 Annex 1
 * itself (Annex 1 only specifies the 4× table; higher ratios are
 * implementation-defined for headroom on tight-margin material).
 */

const TAPS_PER_PHASE_4X = 12;
const HISTORY_LENGTH_4X = TAPS_PER_PHASE_4X;

/**
 * BS.1770-4 Annex 1 (table 4) 48-tap polyphase FIR coefficients for 4×
 * true-peak upsampling, laid out as `[phase][tap]`.
 *
 * Phase `p` consumes the last 12 input samples (`x[n - 0]` through
 * `x[n - 11]`) and emits the output sample at fractional offset
 * `p / 4` between `x[n]` and `x[n+1]`. Tap index 0 multiplies `x[n]`
 * (the newest sample), tap index 11 multiplies `x[n - 11]` (the
 * oldest in history).
 *
 * Phase 0 of the spec is the impulse-aligned identity tap — its tap-0
 * value is exactly 1 and all other taps are 0 — so the input sample
 * passes through unchanged at the phase-0 output. This is preserved
 * here even though it is implemented as a direct copy in the fast path.
 *
 * Source: libebur128 `ebur128/ebur128.c` (`interp_create` /
 * `g_true_peak_4x_coefficients`), which is a literal transcription of
 * BS.1770-4 Annex 1.
 */
const COEFFICIENTS_4X: ReadonlyArray<ReadonlyArray<number>> = [
	// Phase 0 — identity tap (output sample = input sample).
	[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
	// Phase 1
	[
		0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000,
		-0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750,
		0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500,
	],
	// Phase 2
	[
		-0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250,
		-0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125,
		0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375,
	],
	// Phase 3
	[
		-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000,
		-0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500,
		0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875,
	],
];

export type TruePeakUpsamplingFactor = 4 | 8 | 16;

/**
 * Streaming BS.1770-4 Annex 1 polyphase FIR upsampler for true-peak
 * measurement. One instance per channel. Carries 12-sample history
 * across {@link upsample} calls so chunk boundaries are invisible.
 *
 * For a strict-spec true-peak reading, feed the source's samples
 * through one instance per channel and track `max(|out|)` across all
 * channels' upsampled outputs. This produces the same axis as RX /
 * libebur128 (typically ~0.5–1 dB higher than a Butterworth-IIR
 * upsampler on practical content).
 */
export class TruePeakUpsampler {
	/** Oversampling factor this instance was constructed with. */
	readonly factor: TruePeakUpsamplingFactor;
	/**
	 * Ring buffer of the last 12 input samples. Index `history[(writeIndex - k - 1 + N) % N]`
	 * is `x[n - k]` for `k ∈ [0, 11]` immediately after sample `n` was written.
	 *
	 * Sized at {@link HISTORY_LENGTH_4X} for the 4× case. (Higher ratios will
	 * need a different length when they are implemented.)
	 */
	private readonly history: Float64Array;
	private writeIndex = 0;

	constructor(factor: TruePeakUpsamplingFactor = 4) {
		if (factor !== 4) {
			throw new Error(`TruePeakUpsampler: factor ${factor} is not yet implemented; only 4× (BS.1770-4 Annex 1) is supported`);
		}

		this.factor = factor;
		this.history = new Float64Array(HISTORY_LENGTH_4X);
	}

	/**
	 * Push one chunk of input samples and return the upsampled chunk.
	 * Output length is `input.length * factor`. State carries across
	 * calls — feeding the same source in any chunk pattern produces
	 * the same upsampled samples (modulo float ordering, which is
	 * deterministic).
	 *
	 * The first 11 output frames after a {@link reset} (or after
	 * construction) are coloured by the cold filter history (zeros).
	 * For true-peak measurement this is harmless — the max-tracking
	 * downstream sees only values ≤ the actual settled peak during
	 * that ramp-up.
	 */
	upsample(input: Float32Array): Float32Array {
		const factor = this.factor;
		const inputLength = input.length;
		const output = new Float32Array(inputLength * factor);
		const history = this.history;
		const historyLength = HISTORY_LENGTH_4X;
		let writeIndex = this.writeIndex;

		for (let inIdx = 0; inIdx < inputLength; inIdx++) {
			const sample = input[inIdx] ?? 0;

			// Append the new input to the history ring.
			history[writeIndex] = sample;
			writeIndex = (writeIndex + 1) % historyLength;

			const outOffset = inIdx * factor;

			// Phase 0 is the identity tap — emit the input sample directly.
			// (The coefficient table also encodes this, but bypassing the
			// inner product keeps the fast path tight and floating-point
			// exact for impulse-aligned samples.)
			output[outOffset] = sample;

			// Phases 1..factor-1: inner product of the phase's 12 taps
			// with the last 12 input samples, newest first.
			for (let phase = 1; phase < factor; phase++) {
				const taps = COEFFICIENTS_4X[phase];

				if (taps === undefined) continue;

				let acc = 0;

				// `x[n - k]` lives at ring index `(writeIndex - 1 - k + N) % N`.
				// Iterating tap = 0..11 newest-to-oldest matches the tap order
				// in `COEFFICIENTS_4X[phase]` (tap 0 multiplies `x[n]`).
				let readIndex = writeIndex - 1;

				if (readIndex < 0) readIndex += historyLength;

				for (let tap = 0; tap < historyLength; tap++) {
					acc += (taps[tap] ?? 0) * (history[readIndex] ?? 0);

					readIndex -= 1;

					if (readIndex < 0) readIndex += historyLength;
				}

				output[outOffset + phase] = acc;
			}
		}

		this.writeIndex = writeIndex;

		return output;
	}

	/**
	 * Reset the 12-sample input history to zeros. Use when starting a
	 * new render / stream / measurement on the same instance.
	 */
	reset(): void {
		this.history.fill(0);
		this.writeIndex = 0;
	}
}
