/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */

/**
 * Multichannel Speaker Activity Detector (MSAD) per MEF §4.1 Eqs. 31–37.
 *
 * Per-frame, per-channel m, produces a hard activity decision
 * `δ^MSAD_m(ℓ) ∈ {0, 1}` indicating whether the speaker recorded by channel m
 * is talking in this frame. The "channels" that MSAD sees are the target
 * STFT `Y_m` plus each reference STFT `Y_μ` — a single MSAD instance is
 * shared across all of them and reports activity per channel.
 *
 * MSAD outputs drive two MEF mechanisms:
 *
 *   1. **Kalman gain shaping** (MEF §4.1, Eq. 23 driver). When the target is
 *      active (`δ^MSAD_m = 1`), the Kalman correction step is skipped — the
 *      filter coefficient `Ĥ_{m,μ}(ℓ|ℓ)` stays at the prior `Ĥ_{m,μ}(ℓ|ℓ-1)`
 *      so target speech does not corrupt the bleed-path estimate. Implemented
 *      via the `targetActive` short-circuit in `kalmanUpdateFrame`.
 *
 *   2. **Interferer-speech-pause restoration** (MEF §4.1). When an interferer
 *      μ becomes inactive for ≥ 0.5 s, store the current `Ĥ_{m,μ}` and
 *      `P_{m,μ,μ}`. When the interferer returns (transitions inactive →
 *      active), restore the stored state instead of letting the Kalman
 *      re-converge from whatever drift it accumulated during the silence.
 *      Implemented in this module's `applyIspRestoration`.
 *
 * Hyperparameters per the 2026-05-01 parameter-surface decision are
 * hardcoded — NOT user-exposed. MEF Table 1 / §4.1 verbatim:
 *
 *   ϑ^SNR  = 0.25  (per-bin a-posteriori SNR threshold)        — Eq. 33
 *   α      = 0.1   (band-averaged SNR scaling for G^Bin)       — Eq. 35
 *   θ^MSAD = 0.2   (final hard-decision threshold)             — Eq. 37
 *   β_NN   = 4     (noise-PSD overestimation factor)           — Eq. 32
 *   B      = 10    (frequency band count for ξ̄^(B))            — Eq. 36
 *   β_PSD  = 0.5   (input PSD temporal smoothing)              — MEF Table 1
 *
 * **Noise-PSD estimator: Minimum Statistics** (Martin 2001). MEF §4.1 cites
 * [49] (Meyer-Jongebloed-Fingscheidt 2018 ICASSP) for noise-PSD estimation,
 * which we do not have access to. The 2026-05-01 implementation decision
 * "Noise-PSD estimator for MSAD: Minimum Statistics" picks Martin 2001 as
 * the textbook unbiased estimator: track the minimum of the smoothed PSD
 * over a sliding ~1.5-s window via `U` rotating sub-windows of `D` frames
 * each, then apply a bias-correction multiplier.
 *
 *   U   = 8       (sub-windows)
 *   D   = 12      (frames per sub-window) — at hop 1024 / sr 48000:
 *                 8 × 12 × 21.3 ms ≈ 2 s sliding window
 *   bias= 2.0     (Martin's recommended overall bias-correction)
 *
 * Streaming-friendly: per bin, state is U past sub-window minima + the
 * current sub-window's running minimum + a frame counter. Each frame
 * advances one minimum operation per bin; sub-window rotation happens once
 * every D frames.
 *
 * @see Meyer, P., Elshamy, S., & Fingscheidt, T. (2020). "Multichannel
 *   speaker interference reduction using frequency domain adaptive
 *   filtering." EURASIP J. Audio, Speech, Music Proc., 2020:21.
 * @see Martin, R. (2001). "Noise power spectral density estimation based on
 *   optimal smoothing and minimum statistics." IEEE Trans. Speech Audio
 *   Proc., 9(5), 504–512.
 */

import type { KalmanState } from "./mef-kalman";

// MEF §4.1 / Table 1 hyperparameters — hardcoded per the 2026-05-01
// parameter-surface decision. ALPHA, MSAD_THRESHOLD, PSD_SMOOTHING are
// env-overridable for Phase 4 RX-spectral-shape tuning per
// plan-debleed-v2-rx-match.md §4.2; SNR_THRESHOLD, NOISE_OVERESTIMATION,
// BAND_COUNT remain pure MEF Table 1.
const SNR_THRESHOLD = 0.25;
const ALPHA = Number(process.env.DEBLEED_MSAD_ALPHA) || 0.1;
const MSAD_THRESHOLD = Number(process.env.DEBLEED_MSAD_THETA) || 0.2;
const NOISE_OVERESTIMATION = 4;
const BAND_COUNT = 10;
const PSD_SMOOTHING = Number(process.env.DEBLEED_MSAD_BETA_PSD) || 0.5;

// Minimum Statistics tracker constants (Martin 2001).
const MS_SUBWINDOW_COUNT = 8;
const MS_FRAMES_PER_SUBWINDOW = 12;
const MS_BIAS_CORRECTION = 2.0;
// Initial PSD floor — small positive value so the "min" tracker has a finite
// starting point. Anything below it is treated as silence-floor; first real
// speech frames will have PSDs many orders of magnitude above this.
const MS_INITIAL_NOISE = 1e-8;

/**
 * Per-channel Minimum Statistics noise-PSD tracker state.
 *
 * - `noisePsd[k]` — current noise-PSD estimate per bin (post bias-correction).
 * - `currentMin[k]` — running minimum of the smoothed PSD within the current
 *   sub-window. Reset each time a sub-window completes.
 * - `subwindowMins[u * numBins + k]` — past `U` sub-windows' minima per bin.
 *   Rotated cyclically as new sub-windows complete.
 * - `subwindowIndex` — index of the next sub-window slot to overwrite.
 * - `frameInSubwindow` — frame counter within the current sub-window.
 */
export interface MinimumStatisticsState {
	readonly noisePsd: Float32Array;
	readonly currentMin: Float32Array;
	readonly subwindowMins: Float32Array;
	subwindowIndex: number;
	frameInSubwindow: number;
}

/**
 * Per-channel MSAD state. One instance per (target channel + each reference).
 *
 * - `smoothedPsd` — temporally-smoothed `Φ̂_{YY,m}(ℓ,k)` per MEF Eq. 28-style
 *   smoothing with `β_PSD = 0.5`.
 * - `noiseTracker` — Minimum Statistics noise-PSD estimator.
 */
export interface MsadChannelState {
	readonly smoothedPsd: Float32Array;
	readonly noiseTracker: MinimumStatisticsState;
}

/**
 * Per-frame activity decision returned by the MSAD. `targetActive` is the
 * decision for the target channel; `referenceActive[μ]` is the decision for
 * each reference channel. Used by `kalmanUpdateFrame` (target gating) and
 * `applyIspRestoration` (interferer-speech-pause logic).
 */
export interface MsadFrameDecision {
	readonly targetActive: boolean;
	readonly referenceActive: ReadonlyArray<boolean>;
}

/**
 * Allocate Minimum Statistics tracker state for `numBins`. Initial noise PSD
 * is seeded at a small positive floor so the bias-correction division does
 * not produce NaN on the first frame.
 */
function createMinimumStatisticsState(numBins: number): MinimumStatisticsState {
	const noisePsd = new Float32Array(numBins);
	const currentMin = new Float32Array(numBins);
	const subwindowMins = new Float32Array(MS_SUBWINDOW_COUNT * numBins);

	noisePsd.fill(MS_INITIAL_NOISE);
	currentMin.fill(Infinity);
	subwindowMins.fill(Infinity);

	return {
		noisePsd,
		currentMin,
		subwindowMins,
		subwindowIndex: 0,
		frameInSubwindow: 0,
	};
}

/**
 * Allocate per-channel MSAD state for `numBins`.
 */
export function createMsadChannelState(numBins: number): MsadChannelState {
	return {
		smoothedPsd: new Float32Array(numBins),
		noiseTracker: createMinimumStatisticsState(numBins),
	};
}

/**
 * Update the Minimum Statistics noise-PSD estimate for one frame given the
 * smoothed input PSD `Φ̂_{YY}(ℓ,·)`. Mutates `state` in place.
 *
 * Algorithm (Martin 2001 simplified streaming form):
 *
 *   1. Per bin: `currentMin[k] = min(currentMin[k], smoothedPsd[k])`.
 *   2. If `frameInSubwindow == D`: rotate — store `currentMin` into
 *      `subwindowMins[subwindowIndex]`, advance `subwindowIndex` cyclically,
 *      reset `currentMin` to +∞, reset `frameInSubwindow` to 0.
 *   3. Recompute `noisePsd[k]` as `bias × min over all U sub-windows + current`
 *      per bin.
 *
 * The `bias` factor compensates for the downward bias inherent in tracking
 * the minimum (a min estimator is biased low; Martin derives a correction
 * dependent on the smoothing factor, but a fixed 2.0 is a standard
 * conservative choice).
 */
function updateNoisePsd(state: MinimumStatisticsState, smoothedPsd: Float32Array): void {
	const numBins = smoothedPsd.length;

	// Step 1: update running minimum within the current sub-window.
	for (let bin = 0; bin < numBins; bin++) {
		const psd = smoothedPsd[bin]!;

		if (psd < state.currentMin[bin]!) state.currentMin[bin] = psd;
	}

	state.frameInSubwindow++;

	// Step 2: rotate sub-window if D frames complete.
	if (state.frameInSubwindow >= MS_FRAMES_PER_SUBWINDOW) {
		const slotOffset = state.subwindowIndex * numBins;

		for (let bin = 0; bin < numBins; bin++) {
			state.subwindowMins[slotOffset + bin] = state.currentMin[bin]!;
			state.currentMin[bin] = Infinity;
		}

		state.subwindowIndex = (state.subwindowIndex + 1) % MS_SUBWINDOW_COUNT;
		state.frameInSubwindow = 0;
	}

	// Step 3: recompute noise PSD per bin = bias × min(past U sub-windows ∪ current).
	for (let bin = 0; bin < numBins; bin++) {
		let globalMin = state.currentMin[bin]!;

		for (let slot = 0; slot < MS_SUBWINDOW_COUNT; slot++) {
			const slotMin = state.subwindowMins[slot * numBins + bin]!;

			if (slotMin < globalMin) globalMin = slotMin;
		}

		// If still +∞ (file head, no full sub-window completed yet, no input yet),
		// keep prior estimate. Otherwise apply bias correction.
		if (Number.isFinite(globalMin)) {
			state.noisePsd[bin] = MS_BIAS_CORRECTION * globalMin;
		}
	}
}

/**
 * Update the smoothed input PSD per MEF-style temporal smoothing:
 *
 *   Φ̂_{YY,m}(ℓ,k) = β_PSD · Φ̂_{YY,m}(ℓ-1,k) + (1 − β_PSD) · |Y_m(ℓ,k)|²
 *
 * Mutates `state.smoothedPsd` in place.
 */
function updateSmoothedPsd(state: MsadChannelState, channelReal: Float32Array, channelImag: Float32Array): void {
	const numBins = state.smoothedPsd.length;
	const oneMinusBeta = 1 - PSD_SMOOTHING;

	for (let bin = 0; bin < numBins; bin++) {
		const re = channelReal[bin]!;
		const im = channelImag[bin]!;
		const power = re * re + im * im;

		state.smoothedPsd[bin] = PSD_SMOOTHING * state.smoothedPsd[bin]! + oneMinusBeta * power;
	}
}

/**
 * Compute the hard MSAD activity decision for one channel m for one frame.
 *
 * Algorithm (MEF §4.1 Eqs. 31–37 verbatim, applied to a single channel —
 * the full multichannel SPR Eq. 31 is computed once across all channels by
 * `computeMsadDecision`, then this helper is invoked per channel with the
 * pre-computed `sprPositive` mask):
 *
 *   Eq. 32: ξ_m(ℓ,k) = max{ min[Φ̂_{YY,m}(ℓ,k),
 *                            |Y_m(ℓ,k)|² − β_NN·Φ̂_{NN,m}], 0 }
 *                       / (β_NN · Φ̂_{NN,m})
 *           Per MEF §4.1 verbatim: the overestimated noise PSD
 *           Φ̂^overest_{NN,m} = β_NN · Φ̂_{NN,m} appears in BOTH the
 *           numerator subtraction and the denominator (β_NN = 4 is the
 *           "robust during speech pauses" overestimation factor). The
 *           min{·, ·} clamp against the smoothed PSD Φ̂_{YY,m} is part
 *           of the published equation and is retained.
 *   Eq. 33: K⁺_m(ℓ) = {k | SPR_m(ℓ,k) > 0 ∧ ξ_m(ℓ,k) ≥ ϑ^SNR}
 *   Eq. 34: η⁺_m(ℓ) = |K⁺_m(ℓ)| / K^MSAD     (relevant-bin fraction)
 *           Φ^MSAD_m(ℓ) = G^Bin_m(ℓ) · η⁺_m(ℓ)
 *   Eq. 35: G^Bin_m(ℓ) = min(α · ξ̄^(B)_m(ℓ), 1)
 *   Eq. 36: ξ̄^(B)_m(ℓ) = max_b [(1/|K_b|) Σ_{k∈K_b} ξ_m(ℓ,k)]
 *           (max over B = 10 equal-width bands of the band-averaged SNR)
 *   Eq. 37: δ^MSAD_m(ℓ) = 1 if Φ^MSAD_m(ℓ) > θ^MSAD else 0
 *
 * Band partitioning (Eq. 36, ambiguity note): MEF §4.1 doesn't pin the band
 * shapes when `numBins` isn't divisible by B. We split bins into B equal
 * floor-divided ranges with the last band absorbing the remainder. For
 * `numBins = 2049` and `B = 10` this gives bands of size 204, 204, …, 204,
 * 213 — close enough to equal that the max-over-bands behaviour is
 * unaffected by the residue distribution.
 */
function computeChannelDecision(
	channelReal: Float32Array,
	channelImag: Float32Array,
	smoothedPsd: Float32Array,
	noisePsd: Float32Array,
	sprPositive: Uint8Array,
	numBins: number,
): boolean {
	// Per-bin a-posteriori SNR ξ_m(ℓ,k) and relevant-bin count.
	const xi = new Float32Array(numBins);
	let relevantBinCount = 0;

	for (let bin = 0; bin < numBins; bin++) {
		const re = channelReal[bin]!;
		const im = channelImag[bin]!;
		const yPow = re * re + im * im;
		const noise = noisePsd[bin]!;
		const noiseOver = NOISE_OVERESTIMATION * noise;
		// Eq. 32 numerator: max{ min[Φ̂_YY, |Y|² − β_NN·Φ̂_NN], 0 }.
		const yPowMinusOver = yPow - noiseOver;
		const yy = smoothedPsd[bin]!;
		const inner = yPowMinusOver < yy ? yPowMinusOver : yy;
		const numerator = inner > 0 ? inner : 0;
		// Eq. 32 denominator: the OVERESTIMATED noise PSD β_NN·Φ̂_NN (NOT raw
		// Φ̂_NN). Per MEF §4.1: Φ̂^overest_NN replaces Φ̂_NN throughout Eq. 32.
		// Avoid division by 0 when the noise estimate is still at its initial
		// floor.
		const xiBin = noiseOver > 0 ? numerator / noiseOver : 0;

		xi[bin] = xiBin;

		if (sprPositive[bin] === 1 && xiBin >= SNR_THRESHOLD) relevantBinCount++;
	}

	// Eq. 34: η⁺ = |K⁺| / K^MSAD (relevant-bin fraction).
	const etaPlus = relevantBinCount / numBins;

	// Eq. 36: ξ̄^(B) = max_b [band-averaged ξ over B bands].
	// Equal floor-divided band partitioning; last band absorbs the remainder.
	const baseBandSize = Math.floor(numBins / BAND_COUNT);
	let maxBandAvg = 0;

	for (let band = 0; band < BAND_COUNT; band++) {
		const startBin = band * baseBandSize;
		const endBin = band === BAND_COUNT - 1 ? numBins : startBin + baseBandSize;
		const bandSize = endBin - startBin;

		if (bandSize === 0) continue;

		let sum = 0;

		for (let bin = startBin; bin < endBin; bin++) sum += xi[bin]!;

		const bandAvg = sum / bandSize;

		if (bandAvg > maxBandAvg) maxBandAvg = bandAvg;
	}

	// Eq. 35: G^Bin = min(α · ξ̄^(B), 1).
	const gBin = Math.min(ALPHA * maxBandAvg, 1);

	// Eq. 34 final: Φ^MSAD = G^Bin · η⁺.
	const phiMsad = gBin * etaPlus;

	// Eq. 37: δ^MSAD = 1 iff Φ^MSAD > θ^MSAD.
	return phiMsad > MSAD_THRESHOLD;
}

/**
 * Compute the per-frame MSAD decision across all channels.
 *
 * Inputs: STFT bin values for the target channel and each reference channel
 * for the current frame, plus the per-channel MSAD state objects (smoothed
 * PSD + noise tracker), in the order `[target, ref0, ref1, ...]`.
 *
 * Per MEF Eq. 31 the SPR (signal-power ratio) is a multichannel quantity:
 *
 *   SPR_m(ℓ,k) = 10·log₁₀[ξ_*,m(ℓ,k) / max_μ ξ_*,μ(ℓ,k)]
 *
 * with `ξ_*,m = Φ̂_{YY,m} − Φ̂_{NN,m}` (the cleaned PSD, lower-bounded at 0).
 * SPR > 0 dB picks the channel with the loudest cleaned PSD at bin k —
 * equivalent to "channel m has more signal at bin k than any other channel."
 * Since MEF only checks the SIGN of SPR (Eq. 33: `SPR > 0`), we can skip the
 * log-domain conversion and just check whether channel m's cleaned PSD is
 * the maximum across channels (after a guard for ties).
 *
 * Updates each channel's `smoothedPsd` and `noiseTracker` as a side effect.
 *
 * Returns `{ targetActive, referenceActive: [μ0, μ1, ...] }`.
 */
export function computeMsadDecision(
	channelReals: ReadonlyArray<Float32Array>,
	channelImags: ReadonlyArray<Float32Array>,
	channelStates: ReadonlyArray<MsadChannelState>,
): MsadFrameDecision {
	const channelCount = channelStates.length;

	if (channelCount === 0) {
		return { targetActive: false, referenceActive: [] };
	}

	const numBins = channelStates[0]!.smoothedPsd.length;

	// Step 1: update smoothed PSD + Minimum Statistics noise PSD per channel.
	for (let chIdx = 0; chIdx < channelCount; chIdx++) {
		const state = channelStates[chIdx]!;

		updateSmoothedPsd(state, channelReals[chIdx]!, channelImags[chIdx]!);
		updateNoisePsd(state.noiseTracker, state.smoothedPsd);
	}

	// Step 2: cleaned PSD ξ_*,m = max(Φ̂_YY − Φ̂_NN, 0) per channel per bin.
	// Then per bin, find max-channel — that channel has SPR > 0 dB at bin k.
	const cleanedPsds = new Array<Float32Array>(channelCount);

	for (let chIdx = 0; chIdx < channelCount; chIdx++) {
		const cleaned = new Float32Array(numBins);
		const yy = channelStates[chIdx]!.smoothedPsd;
		const nn = channelStates[chIdx]!.noiseTracker.noisePsd;

		for (let bin = 0; bin < numBins; bin++) {
			const diff = yy[bin]! - nn[bin]!;

			cleaned[bin] = diff > 0 ? diff : 0;
		}

		cleanedPsds[chIdx] = cleaned;
	}

	// Step 3: per channel, build SPR-positive mask (1 iff this channel's
	// cleaned PSD is the strict max across channels at bin k).
	const sprMasks = Array.from({ length: channelCount }, () => new Uint8Array(numBins));

	for (let bin = 0; bin < numBins; bin++) {
		let maxValue = -Infinity;
		let maxChannel = -1;

		for (let chIdx = 0; chIdx < channelCount; chIdx++) {
			const value = cleanedPsds[chIdx]![bin]!;

			if (value > maxValue) {
				maxValue = value;
				maxChannel = chIdx;
			}
		}

		// Strict positivity gate: SPR > 0 dB requires the channel's cleaned PSD
		// to actually exceed the others, AND be > 0 (else cleaned PSD is below
		// the noise floor in every channel — no signal to ratio against).
		if (maxChannel >= 0 && maxValue > 0) {
			sprMasks[maxChannel]![bin] = 1;
		}
	}

	// Step 4: per channel, compute Eqs. 32–37 against its SPR-positive mask.
	const decisions = new Array<boolean>(channelCount);

	for (let chIdx = 0; chIdx < channelCount; chIdx++) {
		decisions[chIdx] = computeChannelDecision(channelReals[chIdx]!, channelImags[chIdx]!, channelStates[chIdx]!.smoothedPsd, channelStates[chIdx]!.noiseTracker.noisePsd, sprMasks[chIdx]!, numBins);
	}

	return {
		targetActive: decisions[0]!,
		referenceActive: decisions.slice(1),
	};
}

// ---------------------------------------------------------------------------
// Interferer-Speech-Pause (ISP) restoration per MEF §4.1
// ---------------------------------------------------------------------------

/**
 * Per-(target channel, reference) ISP restoration state. Tracks the most
 * recently-stored Kalman state for the reference μ from when it was last
 * active, plus an "inactive timer" measured in frames.
 *
 * Lifecycle (per MEF §4.1):
 *
 *   - When `δ^MSAD_μ(ℓ) = 1`: store the current `Ĥ_{m,μ}(ℓ|ℓ)` and
 *     `P_{m,μ,μ}(ℓ|ℓ)` into `storedH*` / `storedP`. Reset
 *     `inactiveFrames = 0`.
 *   - When `δ^MSAD_μ(ℓ) = 0`: increment `inactiveFrames`.
 *   - On transition inactive → active (i.e. `inactiveFrames ≥ threshold` AND
 *     current frame's `δ^MSAD_μ = 1`): RESTORE `storedH*` / `storedP` into
 *     the live Kalman state, then update `storedH*` to this frame's restored
 *     value (so the next pause cycle starts from a sensible point).
 *
 * The 0.5-s threshold at default hop=1024 / sr=48000 → 24 frames.
 * Hardcoded as `ISP_THRESHOLD_FRAMES`; override possible by recomputing
 * `Math.round(0.5 * sampleRate / hopSize)` at stream setup.
 */
export interface IspState {
	readonly storedHReal: Float32Array;
	readonly storedHImag: Float32Array;
	readonly storedP: Float32Array;
	inactiveFrames: number;
	hasStored: boolean;
}

/**
 * Default ISP threshold in frames — 0.5 s at hop = 1024, sr = 48000 → 24
 * frames per MEF §4.1. Computed at stream setup as
 * `Math.round(0.5 * sampleRate / hopSize)`; this constant is the fallback /
 * default for tests.
 */
export const ISP_THRESHOLD_FRAMES = 24;

/**
 * Allocate per-(target, reference) ISP state sized for `numBins`.
 */
export function createIspState(numBins: number): IspState {
	return {
		storedHReal: new Float32Array(numBins),
		storedHImag: new Float32Array(numBins),
		storedP: new Float32Array(numBins),
		inactiveFrames: 0,
		hasStored: false,
	};
}

/**
 * Apply ISP restoration logic for one (target, reference) pair for one frame.
 * Mutates `kalmanState` (potentially restoring stored values) and `ispState`.
 *
 * Algorithm per MEF §4.1, evaluated AFTER `kalmanUpdateFrame` writes the
 * current-frame posterior `Ĥ(ℓ|ℓ)` and `P(ℓ|ℓ)`:
 *
 *   1. If `δ^MSAD_μ(ℓ) = 1` AND `inactiveFrames >= thresholdFrames`:
 *      transition pause → active. RESTORE `storedH*` / `storedP` into the
 *      live Kalman state (overwriting the just-computed posterior) — the
 *      Kalman would otherwise be re-converging from drift accumulated during
 *      the pause. Reset `inactiveFrames = 0`. Do NOT re-store, since the
 *      restored state IS the stored state.
 *
 *   2. Else if `δ^MSAD_μ(ℓ) = 1`: interferer is active and was already
 *      active. Store current Ĥ / P into `storedH*` / `storedP`. Reset
 *      `inactiveFrames = 0`.
 *
 *   3. Else (`δ^MSAD_μ(ℓ) = 0`): increment `inactiveFrames`. Leave stored
 *      state unchanged. Live Kalman state is unchanged from
 *      `kalmanUpdateFrame`'s output (which itself may have been a no-op if
 *      the target was active this frame).
 */
export function applyIspRestoration(kalmanState: KalmanState, ispState: IspState, referenceActive: boolean, thresholdFrames: number): void {
	const numBins = kalmanState.hReal.length;

	if (referenceActive) {
		const transitionedToActive = ispState.inactiveFrames >= thresholdFrames && ispState.hasStored;

		if (transitionedToActive) {
			// Step 1: restore stored Kalman state.
			for (let bin = 0; bin < numBins; bin++) {
				kalmanState.hReal[bin] = ispState.storedHReal[bin]!;
				kalmanState.hImag[bin] = ispState.storedHImag[bin]!;
				kalmanState.stateVariance[bin] = ispState.storedP[bin]!;
			}
		} else {
			// Step 2: store current Kalman state.
			for (let bin = 0; bin < numBins; bin++) {
				ispState.storedHReal[bin] = kalmanState.hReal[bin]!;
				ispState.storedHImag[bin] = kalmanState.hImag[bin]!;
				ispState.storedP[bin] = kalmanState.stateVariance[bin]!;
			}

			ispState.hasStored = true;
		}

		ispState.inactiveFrames = 0;
	} else {
		// Step 3: increment inactive timer.
		ispState.inactiveFrames++;
	}
}
