/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

/**
 * Multichannel Wiener filter (MWF) gain mask per MEF §3.1 / §4 (Eqs. 25, 28,
 * 29, 30 + §3.1.1 dominant-bin construction Eqs. 4–8). Stage 2 of the FDAF
 * Kalman + MWF pipeline. Stage 1 (FDAF Kalman) feeds its predicted-bleed
 * output `D̂_{m,μ}(ℓ,k) = Ĥ_{m,μ}(ℓ|ℓ-1) · Y_μ(ℓ,k)` per (target, reference)
 * pair, summed across references into `D̂_m^total`. This stage:
 *
 *   1. Maintain a temporally-smoothed per-interferer PSD per MEF Eq. 28:
 *
 *        Φ̂_{D̂D̂,m}(ℓ,k) = β · Φ̂_{D̂D̂,m}(ℓ-1,k) + (1 − β) · |D̂_m^total(ℓ,k)|²
 *
 *      Combined-bleed across references because the multi-reference fused-node
 *      design (2026-04-21) treats the bleed acoustic model as
 *      `T = A + Σᵢ Hᵢ·Rᵢ` — a single combined interferer at the target.
 *
 *   2. Compute target-input PSD with bleed pre-subtracted per MEF Eq. 29:
 *
 *        Φ̂_{YY,m}(ℓ,k) = |Y^WF_m(ℓ,k) − D̂_m^total(ℓ,k)|²
 *
 *      Under the single-grid simplification (design-de-bleed.md 2026-05-01
 *      "Single-grid MEF Stage 2") the OLS-clip + OLA-WF two-grid pipeline of
 *      Eqs. 26→27→28 collapses to direct application of `Ĥ · Y` at our shared
 *      `K = K_WF = fftSize` grid. So `Y^WF_m` is the target STFT directly and
 *      `D̂_m^total` is what the Kalman wrote.
 *
 *   3. Construct target-PSD `Φ̂_{SS,m}` per MEF Eq. 30 + §3.1.1 dominant-bin
 *      decomposition:
 *
 *        Φ̂_{SS,m}(ℓ,k) = Φ̂^dom_m(ℓ,k) + Φ̂^res_m(ℓ,k)
 *
 *      with the dominant-bin mask `X^dom_m(ℓ,k) = 1` iff bin k is "active" in
 *      both `Φ̂_{YY,m}(ℓ,·)` and the previous-frame `Φ̂_{ŜŜ,m}(ℓ-1,·)`. A bin
 *      is "active" when its PSD is ≥ the per-frame RMS amplitude across bins
 *      (`E_Y,m(ℓ)` and `E_Ŝ,m(ℓ-1)` per MEF Eqs. 4). The two PSDs are then:
 *
 *        Φ̂^dom_m(ℓ,k) = X^dom_m(ℓ,k) · λ_dom · Φ̂_{YY,m}(ℓ,k)              (Eq. 7)
 *        Φ̂^res_m(ℓ,k) = (1 − X^dom_m(ℓ,k)) · [λ^Y_res · Φ̂_{YY,m}(ℓ,k)
 *                                            + λ^Ŝ_res · Φ̂_{ŜŜ,m}(ℓ-1,k)] (Eq. 8)
 *
 *      Hyperparameters from MEF Table 1: `λ_dom = 0.6`, `λ^Y_res = 0.25`,
 *      `λ^Ŝ_res = 0.15`. Hardcoded — not user-exposed per the parameter-surface
 *      decision.
 *
 *      RMS amplitude per MEF Eqs. 4 is the root-mean-square across frequency
 *      bins for THIS frame (not across time) — `sqrt(mean_k(Φ(ℓ,k)))`.
 *      Streaming-compatible because no global / file-wide reduction is
 *      involved. `Φ̂_{ŜŜ,m}(ℓ-1,k) = |Ŝ_m(ℓ-1,k)|²` is squared magnitude of the
 *      previous-frame MWF output; initialised to 0 at frame 0.
 *
 *   4. Compute MWF gain mask per MEF Eq. 25:
 *
 *        W_m(ℓ,k) = Φ̂_{SS,m}(ℓ,k) / [Φ̂_{SS,m}(ℓ,k) + λ · Σ_μ Φ̂_{D̂D̂,m,μ}(ℓ,k)]
 *
 *      `λ` is the user-facing reductionStrength control: MEF Table 1 default
 *      1.5 at user `reductionStrength = 5`, mapped linearly per
 *      `λ = 0.3 · reductionStrength`. The interferer PSD here is the combined
 *      `Φ̂_{D̂D̂,m}` from step 1 (acts as `Σ_μ Φ̂_{D̂D̂,m,μ}` under the multi-ref
 *      fused model). `λ` scales the suppression: larger λ → more bleed
 *      suppression at the cost of more target attenuation.
 *
 *      Output `W ∈ [0, 1]`. Unlike Boll-style oversubtraction, the Wiener
 *      form cannot produce negative numerator; W is always non-negative and
 *      bounded above by 1 (since `Φ̂_{SS} / (Φ̂_{SS} + non-negative) ≤ 1`).
 *
 * **Hard "do not extend" boundary** (per design-de-bleed.md
 * "2026-05-01: Replace stages 1+2 with MEF" Kokkinis-avoidance clause):
 * the per-interferer PSD `Φ̂_{D̂D̂,m}` is computed from the FDAF Kalman bleed
 * estimate `|D̂^WF|²` per Eq. 28 — NOT from a PSD envelope of the target
 * spectrum, NOT from coherence-based estimators. The dominant-bin
 * construction here is MEF's own — it derives the TARGET PSD from the
 * bleed-subtracted spectrum (Eq. 29) and the previous-frame output, not from
 * any Kokkinis PSD-WE (power-spectral-density weighting envelope) machinery.
 * Section 4 of MEF replaces Kokkinis's PSD-WE interferer-PSD estimator with
 * the MAEC-derived `|D̂^WF|²` while keeping the §3.1.1 target-PSD construction.
 *
 * **Block 3 of the 2026-05-01 review correction**: prior implementation used
 * Boll-style oversubtraction `(|Y|² − λ·Φ̂_DD) / (|Y|² + ε)` which is not MEF
 * Eq. 25 and skipped Eqs. 29 / 30 entirely. Fixed to the verbatim Wiener form
 * with bleed-pre-subtracted target PSD and dominant-bin target-PSD
 * construction.
 *
 * @see Meyer, P., Elshamy, S., & Fingscheidt, T. (2020). "Multichannel speaker
 *   interference reduction using frequency domain adaptive filtering." EURASIP
 *   J. Audio, Speech, Music Proc., 2020:21. DOI: 10.1186/s13636-020-00180-6.
 * @see Spriet, A., Doclo, S., Moonen, M. (2010). "Speech enhancement with
 *   multichannel Wiener filter techniques." Speech Enhancement (Springer),
 *   Chapter 9.
 */

// MEF §3.1.1 dominant-bin construction weights. Defaults tuned 2026-05-02
// against iZotope RX as the calibration target — see design-de-bleed.md
// "2026-05-02: RX-parity tuning (Phase 3)" for the full sweep data and
// rationale. MEF Table 1 paper defaults were (0.6, 0.25, 0.15); we ship
// LAMBDA_DOM=0.2 to tilt Φ̂_SS toward suppression on dominant bleed bins
// while keeping Y_RES/S_RES at MEF values (we did not need to tune those
// during the Phase 3 sweep — LAMBDA_DOM alone gave us most of the
// per-band shaping headroom).
//
// Env-var overrides remain available for future tuning experiments. Sum-
// to-one is NOT enforced when overrides are set; lower combined values
// produce more aggressive bleed reduction at the cost of target preservation.
const LAMBDA_DOM = Number(process.env.DEBLEED_LAMBDA_DOM) || 0.2;
const LAMBDA_Y_RES = Number(process.env.DEBLEED_LAMBDA_Y_RES) || 0.25;
const LAMBDA_S_RES = Number(process.env.DEBLEED_LAMBDA_S_RES) || 0.15;

/**
 * Smoothed per-interferer PSD `Φ̂_{D̂D̂,m}` per target channel, plus
 * one-frame previous-output PSD `Φ̂_{ŜŜ,m}(ℓ-1)` used by the dominant-bin
 * construction (MEF §3.1.1). Allocated once per stream lifetime, reused
 * across frames.
 *
 * - `psd` (Φ̂_DD): smoothed combined-bleed PSD per MEF Eq. 28. Initial state
 *   zero — first frame's PSD is `(1 − β) · |D̂_total|²` after smoothing.
 * - `prevOutputPsd` (Φ̂_ŜŜ(ℓ-1)): squared magnitude of the previous frame's
 *   MWF output. Initial state zero per MEF (no previous output at frame 0).
 */
export interface InterfererPsdState {
	readonly psd: Float32Array;
	readonly prevOutputPsd: Float32Array;
}

/**
 * Hyperparameters for the MWF stage. All dimensionless ratios — none scale
 * with bin count.
 *
 * - `temporalSmoothing` (`β`): MEF Eq. 28 PSD smoother, MEF default 0.5.
 *   Hardcoded internal at MEF default per the parameter-surface decision.
 * - `oversubtraction` (`λ`): MEF Table 1 default 1.5. Mapped from user
 *   `reductionStrength` linearly: `λ = 0.3 · reductionStrength` so default
 *   `reductionStrength = 5` gives `λ = 1.5` per the parameter-surface decision.
 *   Range over user 0–10 maps to `λ ∈ [0, 3]`. In MEF Eq. 25 this scales the
 *   interferer-PSD sum in the Wiener denominator.
 */
export interface MwfParams {
	readonly temporalSmoothing: number;
	readonly oversubtraction: number;
}

/**
 * Map user-facing `reductionStrength` (0–10, default 5) to MEF's λ
 * overestimation factor.
 *
 * Mapping: `λ(s) = LAMBDA_SCALE · s`. Linear, range [0, 10·LAMBDA_SCALE].
 *
 * Default tuned 2026-05-02: `LAMBDA_SCALE = 5.0` so `reductionStrength = 10`
 * produces λ = 50 (well past MEF Table 1's λ = 1.5 max). The aggressive
 * default is calibrated against iZotope RX at max strength on real podcast
 * audio — see design-de-bleed.md "2026-05-02: RX-parity tuning (Phase 3)"
 * for sweep data, post-tune residual, and target-preservation trade-off
 * notes. Env override `DEBLEED_LAMBDA_SCALE` remains available.
 */
const LAMBDA_SCALE = Number(process.env.DEBLEED_LAMBDA_SCALE) || 5.0;

// Frequency-dependent oversubtraction λ — power-curve ramp:
//   λ_eff(bin) = λ × (1 + HF_BOOST × (bin / (numBins − 1))^HF_EXPONENT).
// Production defaults HF_BOOST=200, HF_EXPONENT=2 baked 2026-05-02 after
// the Iteration 1 listening sweep on Pierce/Richard — closes the structural
// HF under-reduction gap to RX from mean |gap| 5.31 dB → 3.09 dB. The
// exponent=2 power curve concentrates aggression in the top half of the
// spectrum, leaving LF bands within 0.03 dB of baseline. See
// design-de-bleed.md "2026-05-02: HF-removal power-curve λ ramp" for the
// sweep data.
//
// Env overrides `DEBLEED_HF_BOOST` / `DEBLEED_HF_EXPONENT` remain available;
// using `??` so explicit "0" disables the ramp instead of falling through.
// Stays inside the Wiener-mask gain rule (no PSD envelope tricks) —
// adjacent to Boll (1979) α(f) tradition.
const HF_BOOST = process.env.DEBLEED_HF_BOOST !== undefined ? Number(process.env.DEBLEED_HF_BOOST) : 200;
const HF_EXPONENT = process.env.DEBLEED_HF_EXPONENT !== undefined ? Number(process.env.DEBLEED_HF_EXPONENT) : 2;

export function reductionStrengthToOversubtraction(reductionStrength: number): number {
	return LAMBDA_SCALE * reductionStrength;
}

/**
 * Allocate a zero-initialised `InterfererPsdState` sized for `numBins`.
 */
export function createInterfererPsdState(numBins: number): InterfererPsdState {
	return {
		psd: new Float32Array(numBins),
		prevOutputPsd: new Float32Array(numBins),
	};
}

/**
 * Update the temporally-smoothed per-interferer PSD per MEF Eq. 28 from this
 * frame's combined-bleed estimate (sum across references). Mutates `state.psd`
 * in place.
 *
 * `bleedTotalReal` / `bleedTotalImag` are length-`numBins` slices holding
 * `D̂_m^total(ℓ,k) = Σ_μ Ĥ_{m,μ}(ℓ|ℓ-1) · Y_μ(ℓ,k)`.
 */
export function updateInterfererPsd(
	bleedTotalReal: Float32Array,
	bleedTotalImag: Float32Array,
	state: InterfererPsdState,
	beta: number,
): void {
	const numBins = state.psd.length;
	const oneMinusBeta = 1 - beta;

	for (let bin = 0; bin < numBins; bin++) {
		const dRe = bleedTotalReal[bin]!;
		const dIm = bleedTotalImag[bin]!;
		const dPow = dRe * dRe + dIm * dIm;

		state.psd[bin] = beta * state.psd[bin]! + oneMinusBeta * dPow;
	}
}

/**
 * Compute the MWF gain mask for one frame per MEF Eq. 25 with the §3.1.1
 * dominant-bin target-PSD construction (Eqs. 4–8) and Eq. 29 bleed-subtracted
 * input PSD. Mutates `outMask`.
 *
 * Construction:
 *
 *   Φ̂_YY[k]  = |Y_m[k] − D̂_m^total[k]|²                                (Eq. 29)
 *   E_Y      = sqrt(mean_k Φ̂_YY[k])                                    (Eq. 4 RMS)
 *   E_Ŝ_prev = sqrt(mean_k Φ̂_ŜŜ_prev[k])                               (Eq. 4 RMS, prior frame)
 *   X^dom[k] = 1 iff Φ̂_YY[k] ≥ E_Y AND Φ̂_ŜŜ_prev[k] ≥ E_Ŝ_prev          (Eqs. 4–6)
 *   Φ̂_SS[k]  = X^dom[k] · λ_dom · Φ̂_YY[k]
 *              + (1 − X^dom[k]) · (λ^Y_res · Φ̂_YY[k] + λ^Ŝ_res · Φ̂_ŜŜ_prev[k]) (Eqs. 7–8, 30)
 *   W[k]     = Φ̂_SS[k] / (Φ̂_SS[k] + λ · Φ̂_DD[k])                       (Eq. 25)
 *
 * Hyperparameters from MEF Table 1: `λ_dom = 0.6`, `λ^Y_res = 0.25`,
 * `λ^Ŝ_res = 0.15`. `λ` is the user-controlled reductionStrength (default 1.5).
 *
 * After computing the mask, the caller is expected to apply it to the target
 * STFT bin (`Ŝ_m = W · Y_m`) and write the resulting `|Ŝ_m|²` into
 * `state.prevOutputPsd` for use as `Φ̂_ŜŜ_prev` on the next frame. This
 * function does not perform that write because the application of the mask
 * happens later in the pipeline (after NLM+DFTT smoothing); see
 * `updatePrevOutputPsd`.
 */
export function computeMwfMask(
	targetReal: Float32Array,
	targetImag: Float32Array,
	bleedTotalReal: Float32Array,
	bleedTotalImag: Float32Array,
	psdState: InterfererPsdState,
	mwfParams: MwfParams,
	epsilon: number,
	outMask: Float32Array,
): void {
	const numBins = outMask.length;
	const lambda = mwfParams.oversubtraction;
	const hfBoost = HF_BOOST;
	const hfExponent = HF_EXPONENT;
	const binDenom = numBins > 1 ? numBins - 1 : 1;

	// Eq. 29: Φ̂_YY[k] = |Y_m − D̂_m^total|². Compute once and reuse for both
	// the dominant-bin RMS and the per-bin Φ̂_SS construction.
	// Reuse outMask as scratch for Φ̂_YY to avoid an extra allocation in the
	// inner loop hot path.
	const phiYY = outMask;

	let sumPhiYY = 0;
	let sumPhiSSPrev = 0;

	for (let bin = 0; bin < numBins; bin++) {
		const diffRe = targetReal[bin]! - bleedTotalReal[bin]!;
		const diffIm = targetImag[bin]! - bleedTotalImag[bin]!;
		const yyVal = diffRe * diffRe + diffIm * diffIm;

		phiYY[bin] = yyVal;
		sumPhiYY += yyVal;
		sumPhiSSPrev += psdState.prevOutputPsd[bin]!;
	}

	// Eq. 4: per-frame RMS amplitudes. RMS = sqrt(mean PSD across bins).
	const meanPhiYY = sumPhiYY / numBins;
	const meanPhiSSPrev = sumPhiSSPrev / numBins;
	const rmsPhiYY = Math.sqrt(meanPhiYY);
	const rmsPhiSSPrev = Math.sqrt(meanPhiSSPrev);

	// Eqs. 5–8 + 30: Φ̂_SS construction; Eq. 25: Wiener mask.
	for (let bin = 0; bin < numBins; bin++) {
		const yy = phiYY[bin]!;
		const ssPrev = psdState.prevOutputPsd[bin]!;

		const yyActive = Math.sqrt(yy) >= rmsPhiYY;
		const ssPrevActive = Math.sqrt(ssPrev) >= rmsPhiSSPrev;
		const xDom = yyActive && ssPrevActive ? 1 : 0;

		const phiSS = xDom * LAMBDA_DOM * yy + (1 - xDom) * (LAMBDA_Y_RES * yy + LAMBDA_S_RES * ssPrev);
		const phiDD = psdState.psd[bin]!;
		const binNorm = bin / binDenom;
		const lambdaEff = lambda * (1 + hfBoost * Math.pow(binNorm, hfExponent));
		const denom = phiSS + lambdaEff * phiDD + epsilon;

		const wienerGain = denom > 0 ? phiSS / denom : 0;

		outMask[bin] = wienerGain < 1 ? (wienerGain > 0 ? wienerGain : 0) : 1;
	}
}

/**
 * After the final mask has been applied to the target STFT (post-NLM+DFTT
 * smoothing) the resulting `|Ŝ_m(ℓ,k)|²` must be stored into the PSD state
 * so the NEXT frame's `computeMwfMask` can read it as `Φ̂_ŜŜ(ℓ-1,k)` for the
 * dominant-bin construction.
 *
 * `outputReal` / `outputImag` are the masked target STFT for this frame —
 * `Ŝ_m(ℓ,k) = G_final[k] · Y_m(ℓ,k)`.
 *
 * Note that for the streaming chunked architecture this function should be
 * called once per output frame per target channel. The previous-frame PSD
 * is stored on the per-(target channel) `InterfererPsdState`.
 */
export function updatePrevOutputPsd(
	outputReal: Float32Array,
	outputImag: Float32Array,
	state: InterfererPsdState,
): void {
	const numBins = state.prevOutputPsd.length;

	for (let bin = 0; bin < numBins; bin++) {
		const re = outputReal[bin]!;
		const im = outputImag[bin]!;

		state.prevOutputPsd[bin] = re * re + im * im;
	}
}
