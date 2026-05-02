/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * First-N-seconds warm-up scan that produces an initial frozen H(f) per
 * (target channel, reference) pair using the existing energy-ratio-weighted
 * cross-spectral averaging from `cross-spectral.ts`. Replaces MEF's specified
 * cold-start `Ĥ(ℓ=0) = 0` with a seeded estimate so the Kalman filter avoids
 * the ~2-s convergence transient at file head (MEF Fig. 8).
 *
 * Per design-de-bleed.md "2026-05-01: First-N-seconds warm-up scan replaces
 * whole-file two-pass" — the seed is computed from the first `warmupSeconds`
 * of audio (default 30) regardless of whether the recording is static or
 * dynamic. Static recordings: warm-up estimate ≈ whole-file estimate within
 * plotting precision. Dynamic recordings: warm-up captures path conditions at
 * file head, which is exactly where the Kalman begins adapting from — strictly
 * better seed than whole-file averaging.
 *
 * Degeneracy fallback (per "2026-05-01: First-N-seconds warm-up scan" decision
 * "Degeneracy fallback"): silence-only or NaN-producing warm-up windows are
 * detected after finalization and the seed is rejected via
 * `validateTransferSeed`; callers fall back to MEF's specified cold start.
 */

import type { TransferFunction } from "./cross-spectral";

/**
 * Result of `validateTransferSeed`. `degenerate` is `true` when the seed should
 * be rejected and the caller should fall back to MEF's cold-start. The
 * `reason` string is for logging/telemetry; not a user-facing surface.
 */
export interface SeedValidation {
	readonly degenerate: boolean;
	readonly reason: string;
}

/**
 * Validate a warm-up-derived `TransferFunction` against degeneracy conditions.
 *
 * Conditions per design-de-bleed.md "Degeneracy fallback" + plan
 * "2.5 Implement degeneracy fallback":
 *
 * - **NaN**: any NaN in the seed marks it degenerate. Indicates upstream
 *   division-by-zero or denormal explosion.
 * - **Inf / denormal**: any non-finite value (Inf or denormal) marks it
 *   degenerate. Denormals here would propagate as zeros into Kalman state and
 *   gum up tracking; safer to cold-start.
 * - **Effective silence**: ≥ 80% of bins below `1e-4 × max-bin-magnitude`.
 *   Threshold per the prompt's exact specification. A near-silent warm-up
 *   window produces an under-determined H(f) — the few bins with energy
 *   dominate, and the rest contribute spurious quotient-of-noise values.
 *
 * Returns `{ degenerate: false, reason: "" }` when the seed is usable.
 */
export function validateTransferSeed(transfer: TransferFunction): SeedValidation {
	const numBins = transfer.real.length;

	if (numBins === 0) return { degenerate: true, reason: "empty seed" };

	let maxMag = 0;
	let nanCount = 0;
	let nonFiniteCount = 0;

	for (let bin = 0; bin < numBins; bin++) {
		const hReBin = transfer.real[bin]!;
		const hImBin = transfer.imag[bin]!;

		if (Number.isNaN(hReBin) || Number.isNaN(hImBin)) {
			nanCount++;
			continue;
		}

		if (!Number.isFinite(hReBin) || !Number.isFinite(hImBin)) {
			nonFiniteCount++;
			continue;
		}

		// Denormal check: subnormals are finite but break Kalman propagation.
		// Float32 minimum normal is ~1.18e-38; flag anything between 0 and that
		// magnitude as denormal-suspect. Real zeros pass.
		const minNormal = 1.175494e-38;
		const reAbs = hReBin < 0 ? -hReBin : hReBin;
		const imAbs = hImBin < 0 ? -hImBin : hImBin;

		if ((reAbs > 0 && reAbs < minNormal) || (imAbs > 0 && imAbs < minNormal)) {
			nonFiniteCount++;
			continue;
		}

		const mag = Math.sqrt(hReBin * hReBin + hImBin * hImBin);

		if (mag > maxMag) maxMag = mag;
	}

	if (nanCount > 0) return { degenerate: true, reason: `NaN in ${nanCount} bin(s)` };
	if (nonFiniteCount > 0) return { degenerate: true, reason: `Inf/denormal in ${nonFiniteCount} bin(s)` };

	if (maxMag === 0) return { degenerate: true, reason: "all-zero seed" };

	const silenceThreshold = 1e-4 * maxMag;
	let silentBins = 0;

	for (let bin = 0; bin < numBins; bin++) {
		const hReBin = transfer.real[bin]!;
		const hImBin = transfer.imag[bin]!;
		const mag = Math.sqrt(hReBin * hReBin + hImBin * hImBin);

		if (mag < silenceThreshold) silentBins++;
	}

	if (silentBins >= 0.8 * numBins) {
		return { degenerate: true, reason: `${silentBins}/${numBins} bins below 1e-4 × max-bin-magnitude` };
	}

	return { degenerate: false, reason: "" };
}

/**
 * Cold-start seed: an all-zero `TransferFunction`, matching MEF's specified
 * `Ĥ(ℓ=0) = 0`. Used when the warm-up seed is rejected by
 * `validateTransferSeed`. The Kalman filter absorbs the ~2-s convergence
 * transient cleanly in this case — degraded output at file head, then full
 * quality.
 */
export function coldStartSeed(numBins: number): TransferFunction {
	return {
		real: new Float32Array(numBins),
		imag: new Float32Array(numBins),
	};
}
