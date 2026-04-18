/**
 * Attack/release envelope follower for dynamics processing.
 *
 * Each channel maintains its own envelope state. The envelope smooths the
 * gain reduction signal so sudden level changes produce the characteristic
 * attack/release shape rather than instant step changes.
 *
 * Coefficients are precomputed from time constants in milliseconds:
 *   coeff = exp(-1 / (timeMs * sampleRate / 1000))
 *
 * The state holds the current smoothed gain reduction in dB (negative means
 * reduction is applied).
 */

export interface EnvelopeState {
	/** Current smoothed gain reduction value (dB, typically ≤ 0). */
	gainReductionDb: number;
}

export function makeEnvelopeState(): EnvelopeState {
	return { gainReductionDb: 0 };
}

/**
 * Precomputed smoothing coefficients for attack and release.
 */
export interface EnvelopeCoefficients {
	readonly attack: number;
	readonly release: number;
}

export function makeEnvelopeCoefficients(attackMs: number, releaseMs: number, sampleRate: number): EnvelopeCoefficients {
	const attack = attackMs > 0 ? Math.exp(-1 / (attackMs * sampleRate / 1000)) : 0;
	const release = releaseMs > 0 ? Math.exp(-1 / (releaseMs * sampleRate / 1000)) : 0;

	return { attack, release };
}

/**
 * Smooth a target gain reduction (dB) with attack/release coefficients.
 *
 * When the target is more negative than the current value (more reduction),
 * we are attacking. When the target is less negative (less reduction, gain
 * returning toward unity), we are releasing.
 *
 * Mutates state in place and returns the new smoothed value.
 */
export function smoothGainReduction(
	targetGainReductionDb: number,
	state: EnvelopeState,
	coeffs: EnvelopeCoefficients,
): number {
	const current = state.gainReductionDb;
	// More negative target = more compression needed (attack direction)
	const coeff = targetGainReductionDb < current ? coeffs.attack : coeffs.release;

	state.gainReductionDb = coeff * current + (1 - coeff) * targetGainReductionDb;

	return state.gainReductionDb;
}
