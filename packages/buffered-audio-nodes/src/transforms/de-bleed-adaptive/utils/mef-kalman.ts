/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * Frequency-domain adaptive filter (FDAF) Kalman update for the bleed
 * transfer-function estimate `Ĥ_{m,μ}(ℓ,k)`. Per (target m, reference μ, bin k)
 * scalar state, per-frame prediction + correction. Per the design-de-bleed.md
 * "2026-05-01: Use existing fftSize=4096 STFT for MEF stages 1+2" decision the
 * per-bin count is `K_kalman = numBins = fftSize/2 + 1`, not MEF's literal
 * `K = 1024 / 2 + 1`. Hyperparameters (`A`, `β`, `λ`) are dimensionless ratios
 * that carry over unchanged.
 *
 * State per (m, μ, bin):
 *
 *   Ĥ      : complex coefficient (real + imag Float32Array of length numBins)
 *   P      : real scalar state-error variance — diagonal-only per MEF [47]
 *            ("intra-channel only"), so off-diagonal `P_{m,μ,ν}` for μ ≠ ν
 *            are not propagated, only `P_{m,μ,μ}` is tracked. Eq. 15 then
 *            reduces to `P(ℓ|ℓ-1) = A² · P(ℓ-1|ℓ-1) + Ψ^Δ_{m,μ,μ}(ℓ-1)`,
 *            where Ψ^Δ is itself derived from the prior frame's state per
 *            Eq. 16 (see below).
 *
 * Per-frame update sequence (per MEF §3.2):
 *
 *   Eq. 16 — Ψ^Δ_{m,μ,μ}(ℓ-1) = (1 − A²) · [|Ĥ_{m,μ}(ℓ-1|ℓ-1)|² + P_{m,μ,μ}(ℓ-1|ℓ-1)]
 *            State-dependent per-bin per-frame process noise. Evaluated at
 *            frame ℓ-1 BEFORE the Eq. 15 covariance prediction at frame ℓ.
 *            (Per the 2026-05-01 review: the prior implementation used a
 *            constant `(1 − A²)` scalar — that was a steady-state shortcut
 *            that does not match MEF's actual derivation. Fixed to the
 *            verbatim form here.)
 *   Eq. 14 — Ĥ(ℓ|ℓ-1) = A · Ĥ(ℓ-1|ℓ-1)                               (prediction)
 *   Eq. 15 — P(ℓ|ℓ-1) = A² · P(ℓ-1|ℓ-1) + Ψ^Δ_{m,μ,μ}(ℓ-1)            (covariance prediction)
 *   Eq. 17 — preliminary error per bin
 *              e_m(ℓ,k) = Y_m(ℓ,k) − Σ_μ Ĥ_{m,μ}(ℓ|ℓ-1) · Y_μ(ℓ,k)
 *   Eq. 23 — Ψ^S_m(ℓ,k) = β · Ψ^S_m(ℓ-1,k)
 *              + (1 − β) · [|e_m|² + (R/K) · Σ_μ Σ_ν Y_μ · P_{m,μ,ν} · Y_ν*]
 *            With diagonal-only P (intra-channel), the inner double sum
 *            collapses to Σ_μ |Y_μ|² · P_{m,μ,μ}. The `(R/K)` factor is
 *            `hopSize / fftSize` (= 0.25 at default hop=1024 / fft=4096) per
 *            MEF Eq. 23 verbatim.
 *   Eq. 20 — K_{m,μ}(ℓ,k) = (P_{m,μ,μ}(ℓ|ℓ-1) · Y_μ*(ℓ,k))
 *                            / Ψ^S_m(ℓ,k)
 *            Per [47] diagonal-only; Σ_ν reduces to ν = μ.
 *   Eq. 18 — Ĥ_{m,μ}(ℓ|ℓ) = Ĥ_{m,μ}(ℓ|ℓ-1) + K_{m,μ} · e_m(ℓ,k)        (correction)
 *
 *   Covariance correction (standard Kalman / MEF Eq. 22 family, diagonal):
 *     P_{m,μ,μ}(ℓ|ℓ) = max(1 − Re{K_{m,μ} · Y_μ}, 0) · P_{m,μ,μ}(ℓ|ℓ-1)
 *
 *   The `max(…, 0)` clamp is a numerical safety guard — the Joseph / Kalman
 *   form `(1 − K·Y)·P` is theoretically non-negative, but finite-precision
 *   arithmetic can produce a slightly-negative reduction factor on
 *   well-converged bins where `K·Y ≈ 1`. Clamping to 0 prevents negative
 *   variance from propagating into the next frame's Eq. 15 prediction.
 *   This is non-MEF but a standard numerical hygiene pattern.
 *
 * The `Y_μ` is the reference-mic STFT bin value; `Y_m` is the target-mic STFT
 * bin value. MSAD gating of the update is applied externally — when
 * `targetActive` is true the per-frame update is short-circuited (or in MEF's
 * formulation `Ψ^S_m` is driven high so the Kalman gain → 0). Phase 2 stubs
 * MSAD to "no target speech active" so updates always run; Phase 3 wires it.
 *
 * @see Meyer, P., Elshamy, S., & Fingscheidt, T. (2020). "Multichannel speaker
 *   interference reduction using frequency domain adaptive filtering." EURASIP
 *   J. Audio, Speech, Music Proc., 2020:21. DOI: 10.1186/s13636-020-00180-6.
 * @see Enzner, G. & Vary, P. (2006). "Frequency-domain adaptive Kalman filter
 *   for acoustic echo control in hands-free telephones." Signal Processing,
 *   86(6), 1140–1156.
 */

import type { TransferFunction } from "./cross-spectral";

/**
 * Per (target, reference, bin) Kalman state. Allocated once per stream lifetime
 * and reused across all frames. The complex coefficient arrays Ĥ_real / Ĥ_imag
 * carry the latest posterior estimate `Ĥ(ℓ|ℓ)`. The real-valued P (diagonal
 * variance) and Ψ^S (measurement-noise variance) are tracked alongside.
 *
 * Layout note: state lives per-(target channel, reference) pair. With
 * `targetChannels` channels and `refCount` references this is
 * `targetChannels × refCount` independent KalmanState records, each holding
 * three Float32Arrays of length `numBins`.
 */
export interface KalmanState {
	readonly hReal: Float32Array;
	readonly hImag: Float32Array;
	readonly stateVariance: Float32Array;
	readonly measurementVariance: Float32Array;
}

/**
 * Hyperparameter bundle for the FDAF Kalman update. All fields are
 * per-stream-constant and dimensionless ratios; none scale with bin count.
 *
 * - `markovForgetting` (`A`): MEF Eq. 14, default 0.998 at user
 *   `adaptationSpeed = 3` (per design-de-bleed.md 2026-05-01 parameter
 *   surface). Higher A = more stable / slower tracking; lower A = faster
 *   adaptation. The mapping is `A(s) = 0.998^(2^((s−3)/3))` so s=3 → A=0.998,
 *   s=10 → A ≈ 0.926, s=0 → A ≈ 1 − tiny — a doubling-rate warp around the
 *   default that keeps default-recording behaviour at MEF's tested point.
 * - `temporalSmoothing` (`β`): MEF Eq. 23 measurement-noise covariance
 *   smoother, MEF default 0.5. Hardcoded internal at MEF default per the
 *   parameter-surface decision.
 * - `rOverK`: MEF Eq. 23 `(R/K)` factor — `hopSize / fftSize`. Scales the
 *   process-noise contribution `Σ_μ |Y_μ|² · P_{m,μ,μ}` to the
 *   measurement-noise covariance update. At default `hopSize = 1024`,
 *   `fftSize = 4096` this is `0.25`. (Block 2 of the 2026-05-01 review
 *   correction: prior implementation dropped this factor.)
 *
 * Process noise `Ψ^Δ` is computed per-bin per-frame from prior-frame
 * `(|Ĥ|², P)` per MEF Eq. 16, NOT carried as a constant — see the per-frame
 * update sequence in `kalmanUpdateFrame`.
 */
export interface KalmanParams {
	readonly markovForgetting: number;
	readonly temporalSmoothing: number;
	readonly rOverK: number;
}

/**
 * Map user-facing `adaptationSpeed` (0–10, default 3) to MEF's Markov
 * forgetting factor `A`. Default of 3 must produce A = 0.998 (MEF Table 1
 * default).
 *
 * Mapping: `A(s) = 0.998^(2^((s−3)/3))`.
 *
 *   s = 0   → A = 0.998^(2^(-1))    ≈ 0.99900   (very stable)
 *   s = 3   → A = 0.998^1           = 0.998     (MEF default)
 *   s = 6   → A = 0.998^2           = 0.996004  (faster)
 *   s = 10  → A = 0.998^(2^(7/3))   ≈ 0.989954  (fastest)
 *
 * Doubling-rate warp around the default: each +3 on `adaptationSpeed` doubles
 * the per-frame deviation from 1 (i.e. `1 − A`).
 */
export function adaptationSpeedToMarkovForgetting(adaptationSpeed: number): number {
	const exponent = Math.pow(2, (adaptationSpeed - 3) / 3);

	return Math.pow(0.998, exponent);
}

/**
 * Allocate a `KalmanState` sized for `numBins`. Fill `Ĥ` from `seed` (warm-up
 * estimate or all-zero cold start). Initial `P` is set to 1.0 (MEF specifies
 * an identity-like initial covariance — for a unit-variance signal this is
 * the steady-state-equivalent default; the Kalman absorbs the actual variance
 * within a handful of frames either way). `Ψ^S` starts at 1.0 to match.
 *
 * Reuse across all frames; do not re-create per chunk.
 */
export function createKalmanState(numBins: number, seed: TransferFunction): KalmanState {
	const hReal = new Float32Array(numBins);
	const hImag = new Float32Array(numBins);

	hReal.set(seed.real);
	hImag.set(seed.imag);

	const stateVariance = new Float32Array(numBins);
	const measurementVariance = new Float32Array(numBins);

	stateVariance.fill(1);
	measurementVariance.fill(1);

	return { hReal, hImag, stateVariance, measurementVariance };
}

/**
 * One-frame FDAF Kalman update across all references for one target channel,
 * across all bins. Mutates each `KalmanState` in place. Writes the combined
 * predicted bleed `D̂_m^total = Σ_μ Ĥ_{m,μ}(ℓ|ℓ-1) · Y_μ` to `outBleedReal` /
 * `outBleedImag` for use by Stage 2 (MWF) per MEF Eq. 28's PSD update.
 *
 * Per-frame sequence per MEF §3.2:
 *
 *   1. **Predict pass** — for each reference μ, FIRST compute Eq. 16
 *      state-dependent process noise from prior-frame state:
 *        `Ψ^Δ_{m,μ,μ}(ℓ-1) = (1 − A²) · (|Ĥ_{m,μ}(ℓ-1|ℓ-1)|² + P_{m,μ,μ}(ℓ-1|ℓ-1))`.
 *      THEN apply Eq. 14 prior coefficient and Eq. 15 prior covariance:
 *        `Ĥ_{m,μ}(ℓ|ℓ-1) = A · Ĥ_{m,μ}(ℓ-1|ℓ-1)`,
 *        `P_{m,μ,μ}(ℓ|ℓ-1) = A² · P_{m,μ,μ}(ℓ-1|ℓ-1) + Ψ^Δ_{m,μ,μ}(ℓ-1)`.
 *      Compute per-reference predicted bleed `D̂_{m,μ}` and accumulate into
 *      combined `D̂_m^total`.
 *
 *   2. **Error compute** — preliminary error per Eq. 17:
 *      `e_m(ℓ,k) = Y_m(ℓ,k) − D̂_m^total(ℓ,k)`.
 *
 *   3. **Update pass** — for each reference μ, compute Ψ^S per Eq. 23 (with
 *      diagonal-only covariance the inner double sum collapses to
 *      `|Y_μ|² · P_{m,μ,μ}`; the `R/K = hopSize/fftSize` factor is applied
 *      verbatim). Compute Kalman gain per Eq. 20, correct Ĥ per Eq. 18 and
 *      P per Eq. 22 (with `max(…, 0)` numerical-safety clamp).
 *
 * `targetActive` (MEF MSAD gating, MEF Eq. 23 driver): when true, the
 * correction step is short-circuited — Ĥ stays at its prior value and P
 * stays at its prior value. Phase 2 stub passes false unconditionally.
 */
export function kalmanUpdateFrame(
	targetReal: Float32Array,
	targetImag: Float32Array,
	refReals: ReadonlyArray<Float32Array>,
	refImags: ReadonlyArray<Float32Array>,
	states: ReadonlyArray<KalmanState>,
	kalmanParams: KalmanParams,
	outBleedReal: Float32Array,
	outBleedImag: Float32Array,
	targetActive: boolean,
): void {
	const numBins = outBleedReal.length;
	const refCount = states.length;
	const { markovForgetting, temporalSmoothing, rOverK } = kalmanParams;
	const aSquared = markovForgetting * markovForgetting;
	const oneMinusASquared = 1 - aSquared;
	const oneMinusBeta = 1 - temporalSmoothing;

	// --- Predict pass: build combined predicted bleed D̂_m^total across refs.
	// Also write the prior Ĥ back into hReal/hImag so the update pass reads
	// the prior coefficient. P_prior is folded into stateVariance for the same
	// reason; on entry to the update pass, stateVariance carries the prior P.
	outBleedReal.fill(0);
	outBleedImag.fill(0);

	for (let refIndex = 0; refIndex < refCount; refIndex++) {
		const state = states[refIndex]!;
		const refReal = refReals[refIndex]!;
		const refImag = refImags[refIndex]!;

		for (let bin = 0; bin < numBins; bin++) {
			// MEF Eq. 16: Ψ^Δ from prior-frame (Ĥ, P) BEFORE updating either.
			const hPrevRe = state.hReal[bin]!;
			const hPrevIm = state.hImag[bin]!;
			const pPrev = state.stateVariance[bin]!;
			const hPrevMagSq = hPrevRe * hPrevRe + hPrevIm * hPrevIm;
			const psiDelta = oneMinusASquared * (hPrevMagSq + pPrev);

			// Eq. 14: Ĥ(ℓ|ℓ-1) = A · Ĥ(ℓ-1|ℓ-1)
			// Eq. 15: P(ℓ|ℓ-1) = A² · P(ℓ-1|ℓ-1) + Ψ^Δ(ℓ-1)
			const hPriorRe = markovForgetting * hPrevRe;
			const hPriorIm = markovForgetting * hPrevIm;
			const pPrior = aSquared * pPrev + psiDelta;

			state.hReal[bin] = hPriorRe;
			state.hImag[bin] = hPriorIm;
			state.stateVariance[bin] = pPrior;

			const yReBin = refReal[bin]!;
			const yImBin = refImag[bin]!;
			const dRe = hPriorRe * yReBin - hPriorIm * yImBin;
			const dIm = hPriorRe * yImBin + hPriorIm * yReBin;

			outBleedReal[bin] = outBleedReal[bin]! + dRe;
			outBleedImag[bin] = outBleedImag[bin]! + dIm;
		}
	}

	// --- Update pass: per-reference Ĥ and P correction using the combined
	// preliminary error e_m = Y_m − D̂_m^total.
	if (targetActive) {
		// MSAD-gated: skip correction; states already hold the prior values.
		// (Phase 2 stub passes false; Phase 3 will exercise this path.)
		return;
	}

	for (let refIndex = 0; refIndex < refCount; refIndex++) {
		const state = states[refIndex]!;
		const refReal = refReals[refIndex]!;
		const refImag = refImags[refIndex]!;

		for (let bin = 0; bin < numBins; bin++) {
			// e_m = Y_m − D̂_m^total
			const eRe = targetReal[bin]! - outBleedReal[bin]!;
			const eIm = targetImag[bin]! - outBleedImag[bin]!;

			const yReBin = refReal[bin]!;
			const yImBin = refImag[bin]!;
			const yMagSq = yReBin * yReBin + yImBin * yImBin;
			const pPrior = state.stateVariance[bin]!;

			// Eq. 23 (diagonal): Ψ^S = β·Ψ_prev + (1 − β) · (|e|² + (R/K)·|Y_μ|²·P_prior)
			const eMagSq = eRe * eRe + eIm * eIm;
			const psiNew = temporalSmoothing * state.measurementVariance[bin]! + oneMinusBeta * (eMagSq + rOverK * yMagSq * pPrior);

			// Eq. 20: K = (P_prior · Y_μ*) / Ψ^S, with Y_μ* = (yRe, −yIm)
			const psiSafe = psiNew + 1e-30;
			const kRe = pPrior * yReBin / psiSafe;
			const kIm = pPrior * (-yImBin) / psiSafe;

			// Eq. 18: Ĥ(ℓ|ℓ) = Ĥ(prior) + K · e
			const correctionRe = kRe * eRe - kIm * eIm;
			const correctionIm = kRe * eIm + kIm * eRe;

			state.hReal[bin] = state.hReal[bin]! + correctionRe;
			state.hImag[bin] = state.hImag[bin]! + correctionIm;

			// Eq. 22 family (diagonal): P(ℓ|ℓ) = max(1 − Re{K · Y_μ}, 0) · P_prior.
			// `max(…, 0)` is a numerical-safety clamp (non-MEF) — finite-precision
			// arithmetic can produce a slightly-negative reduction factor on
			// well-converged bins where K·Y ≈ 1; clamping prevents negative
			// variance from propagating.
			const kDotY = kRe * yReBin - kIm * yImBin;
			const reductionFactor = 1 - kDotY > 0 ? 1 - kDotY : 0;

			state.stateVariance[bin] = reductionFactor * pPrior;
			state.measurementVariance[bin] = psiNew;
		}
	}
}
