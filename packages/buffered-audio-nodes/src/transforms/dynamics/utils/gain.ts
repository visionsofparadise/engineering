/**
 * Gain computation for dynamics processing.
 *
 * This module is deliberately isolated so Phase 4 can wrap it with
 * oversampling. The functions here operate in the dB domain and are
 * pure (no side effects).
 *
 * Downward compression: reduces gain when the level exceeds the threshold.
 * Upward expansion: increases gain when the level is below the threshold.
 *
 * Soft knee: transitions gradually around the threshold within ±knee/2 dB,
 * reducing audible artifacts at the compression onset.
 */

export type DynamicsMode = "downward" | "upward";

const MIN_LINEAR = 1e-10;

/**
 * Convert a linear amplitude value to dBFS.
 * Clamps to a very small number to avoid -Infinity.
 */
export function linearToDb(linear: number): number {
	return 20 * Math.log10(Math.max(linear, MIN_LINEAR));
}

/**
 * Convert dBFS to a linear amplitude multiplier.
 */
export function dbToLinear(db: number): number {
	return Math.pow(10, db / 20);
}

/**
 * Compute the static gain reduction (dB) for a given input level.
 *
 * Returns a value ≤ 0 for downward compression (gain reduction), or
 * ≥ 0 for upward expansion (gain increase).
 *
 * @param levelDb - Input level in dB
 * @param thresholdDb - Compression threshold in dB
 * @param ratio - Compression ratio (e.g. 4 = 4:1). Use a large value like 100 for limiting.
 * @param kneeDb - Soft knee width in dB (0 = hard knee). The knee spans ±kneeDb/2 around the threshold.
 * @param mode - "downward" compresses above threshold; "upward" expands below threshold.
 */
export function computeGainReductionDb(
	levelDb: number,
	thresholdDb: number,
	ratio: number,
	kneeDb: number,
	mode: DynamicsMode,
): number {
	const halfKnee = kneeDb / 2;

	if (mode === "downward") {
		// Downward compression: above threshold, gain is reduced
		const excess = levelDb - thresholdDb;

		if (kneeDb > 0 && excess >= -halfKnee && excess <= halfKnee) {
			// Soft knee zone: quadratic interpolation via normalized position within knee
			const kneePos = (excess + halfKnee) / kneeDb;

			return (1 / ratio - 1) * (excess + halfKnee) * kneePos / 2;
		}

		if (excess > halfKnee) {
			// Above knee: full compression
			return (excess * (1 / ratio - 1));
		}

		// Below knee: no reduction
		return 0;
	}

	// Upward expansion: below threshold, gain is added to bring level up
	const deficit = thresholdDb - levelDb;

	if (kneeDb > 0 && deficit >= -halfKnee && deficit <= halfKnee) {
		// Soft knee zone
		const kneePos = (deficit + halfKnee) / kneeDb;

		return (ratio - 1) * (deficit + halfKnee) * kneePos / 2;
	}

	if (deficit > halfKnee) {
		// Below knee: full expansion
		return (deficit * (ratio - 1));
	}

	// Above threshold: no expansion
	return 0;
}
