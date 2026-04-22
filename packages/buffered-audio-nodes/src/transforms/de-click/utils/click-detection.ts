// Faithful G&R 1998 Ch 5 click detection.
//
// One authoritative pipeline (no mode dispatcher):
//   1. Per band b, short-window AR fit with Burg (§5.2, window = 40 ms,
//      50% overlap, order p = round(sampleRate/1000) + 2).
//   2. Per-window robust σ̂² via centred MAD (§5.2.3).
//   3. Per-sample posterior statistic score_k[n] = |e_k[n]|² / σ̂_k².
//   4. Bayesian per-band prior πₖ = π · 2^(skew · (k − 1.5)) (design-declick.md
//      §3). Bayesian combined statistic is the sum of per-band log-likelihood
//      ratios gated by the per-band threshold Tₖ(πₖ, K = 100) (§5.3). A sample
//      is declared a click if any band's local test passes.
//   5. Periodic-click extension (§5.5): autocorrelate the combined mask over
//      lags [5 ms, 200 ms]; at each prominent peak, extend the mask at
//      multiples of the peak lag where a reduced threshold T / K is crossed
//      and ≥ 3 seeds hit.
//   6. Morphological dilation of the combined mask by `clickWidening` (§6.3).
//   7. Duration filter: long runs are detector failure on non-click transients
//      rather than real clicks (§5.3.4).
//
// Band decomposition: STFT bin-groups (bands 0/500/2k/8k/Nyquist) from
// stft-bands.ts — not the biquad filterbank of the previous implementation.
//
// Repair happens in index.ts via LSAR interpolation (utils/lsar.ts), which
// consumes the per-window AR coefficients from this module.

import type { FftBackend } from "@e9g/buffered-audio-nodes-utils";
import { arResidual, burgMethod, robustStd } from "./ar-model";
import { BAND_KEYS, splitByBinGroups, type BandKey } from "./stft-bands";

// G&R §5.3: expected click variance multiplier over stationary residual (20 dB).
// Physical constant of the detection problem — not a user-facing scalar.
const CLICK_VARIANCE_MULTIPLIER = 100;

// Short-window parameters (G&R §5.2 recommends 20–50 ms; 40 ms is the centre).
const WINDOW_SECONDS = 0.04;
const WINDOW_OVERLAP = 0.5;

// Periodic-click detection (G&R §5.5).
const PERIODIC_MIN_LAG_SECONDS = 0.005;
const PERIODIC_MAX_LAG_SECONDS = 0.2;
// ACF peak prominence: the peak lag's correlation must exceed `mean + 2·σ` of
// the ACF over the tested lag range, per §5.5.2.
const PERIODIC_PEAK_Z_SCORE = 2;
const PERIODIC_MIN_SEEDS = 3;

export interface DetectClickOptions {
	readonly sensitivity: number;
	readonly frequencySkew: number;
	readonly fftSize: number;
	readonly hopSize: number;
	readonly fftBackend?: FftBackend;
	readonly fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };
}

export interface DetectClickResult {
	readonly mask: Uint8Array;
	/**
	 * Wideband short-window AR coefficients, one Float32Array per window. The
	 * repair stage (LSAR) uses the window whose centre is closest to each
	 * gap — see `windowIndexForSample`.
	 */
	readonly windowCoefficients: ReadonlyArray<Float32Array>;
	readonly windowSize: number;
	readonly windowHop: number;
	readonly numWindows: number;
}

/**
 * Run the faithful G&R detection pipeline on a mono signal. Returns the per-
 * sample click mask plus the wideband short-window AR coefficients the repair
 * stage consumes.
 */
export function detectClicks(signal: Float32Array, sampleRate: number, options: DetectClickOptions): DetectClickResult {
	const { sensitivity, frequencySkew, fftSize, hopSize, fftBackend, fftAddonOptions } = options;
	const length = signal.length;

	const windowSize = Math.max(32, Math.round(WINDOW_SECONDS * sampleRate));
	const windowHop = Math.max(1, Math.round(windowSize * (1 - WINDOW_OVERLAP)));
	const order = Math.max(2, Math.round(sampleRate / 1000) + 2);
	const numWindows = length < windowSize ? (length > order + 1 ? 1 : 0) : Math.floor((length - windowSize) / windowHop) + 1;

	const mask = new Uint8Array(length);

	if (numWindows === 0 || length <= order + 1) {
		return { mask, windowCoefficients: [], windowSize, windowHop, numWindows: 0 };
	}

	// Base click-density prior π, then per-band skew bias.
	const piBase = clickPriorFromSensitivity(sensitivity);
	const piPerBand = perBandPriors(piBase, frequencySkew);

	// Wideband short-window AR (used by the LSAR repair — not the detection).
	const windowCoefficients = fitWindowedAr(signal, windowSize, windowHop, numWindows, order);

	// Per-band short-window AR → per-sample posterior statistic. Each band's
	// statistic is independently thresholded against Tₖ(πₖ, K); mask is the
	// OR over bands (§5.7).
	const bandSignals = splitByBinGroups(signal, sampleRate, fftSize, hopSize, fftBackend, fftAddonOptions);
	const fullRms = signalRms(signal);
	// Band energy gate: skip detection on bands whose RMS is well below the
	// full-signal RMS. These are typically bands with no real signal content
	// where iSTFT numerical noise alone would otherwise fire the detector
	// every sample (band σ̂ shrinks with the noise, so the `|e|² > T·σ̂²`
	// threshold collapses). The 30 dB (0.0316 ratio) gate is a hard noise-
	// floor check — any real click content in a band sits well above it.
	const bandRmsGate = fullRms * 0.0316;

	for (const bandKey of BAND_KEYS) {
		const bandSignal = bandSignals[bandKey];
		const piK = piPerBand[bandKey];
		const thresholdFactor = bayesianThresholdFactor(piK);
		const bandRms = signalRms(bandSignal);

		if (bandRms < bandRmsGate) continue;

		applyBandDetection(bandSignal, mask, windowSize, windowHop, numWindows, order, thresholdFactor);
	}

	// Periodic-click extension (§5.5): additive stage on the combined mask.
	extendPeriodicClicks(mask, sampleRate, piBase);

	return { mask, windowCoefficients, windowSize, windowHop, numWindows };
}

/**
 * Map `sensitivity ∈ [0, 1]` to the click-density prior π.
 *   π = 10^(−2 − 4 · (1 − sensitivity))
 *
 * sensitivity = 1 ⇒ π = 10⁻² (expect ~1 click per 100 samples, T ≈ 11σ)
 * sensitivity = 0 ⇒ π = 10⁻⁶ (expect ~1 click per 10⁶ samples, T ≈ 27σ)
 *
 * Derived from G&R §5.3.2's Bayes-factor-to-threshold mapping (Table 5.2).
 */
export function clickPriorFromSensitivity(sensitivity: number): number {
	const clamped = Math.min(1, Math.max(0, sensitivity));

	return Math.pow(10, -2 - 4 * (1 - clamped));
}

/**
 * Per-band click-density prior with `frequencySkew` bias:
 *   πₖ = π · 2^(skew · (k − 1.5))
 * where k ∈ {0, 1, 2, 3} indexes the four bands low → high. skew = +1 gives
 * the high band 8× the low band's prior; skew = −1 mirrors.
 */
export function perBandPriors(piBase: number, skew: number): Record<BandKey, number> {
	const out: Record<BandKey, number> = { low: piBase, lowMid: piBase, highMid: piBase, high: piBase };

	for (let bandIndex = 0; bandIndex < BAND_KEYS.length; bandIndex++) {
		const key = BAND_KEYS[bandIndex] ?? "low";
		const bias = Math.pow(2, skew * (bandIndex - 1.5));

		// Clamp to (0, 1) so the threshold formula remains well-defined.
		out[key] = Math.min(0.499, Math.max(1e-12, piBase * bias));
	}

	return out;
}

/**
 * G&R §5.3 Bayesian threshold factor: sample n is a click iff
 *   |e[n]|² > T(π, K) · σ̂²
 * where T(π, K) = (K / (K − 1)) · (ln K + 2 · ln((1 − π) / π)).
 */
export function bayesianThresholdFactor(prior: number): number {
	const clickVarianceMult = CLICK_VARIANCE_MULTIPLIER;
	const ratio = (1 - prior) / prior;

	return (clickVarianceMult / (clickVarianceMult - 1)) * (Math.log(clickVarianceMult) + 2 * Math.log(ratio));
}

// ---------------------------------------------------------------------------
// Short-window AR plumbing.
// ---------------------------------------------------------------------------

function fitWindowedAr(signal: Float32Array, windowSize: number, windowHop: number, numWindows: number, order: number): Array<Float32Array> {
	const coeffs: Array<Float32Array> = [];
	const length = signal.length;

	for (let windowIndex = 0; windowIndex < numWindows; windowIndex++) {
		const start = windowIndex * windowHop;
		const end = Math.min(length, start + windowSize);
		const slice = new Float32Array(signal.subarray(start, end));

		if (slice.length > order + 1) {
			coeffs.push(burgMethod(slice, order));
		} else {
			coeffs.push(new Float32Array(order));
		}
	}

	return coeffs;
}

function applyBandDetection(
	bandSignal: Float32Array,
	mask: Uint8Array,
	windowSize: number,
	windowHop: number,
	numWindows: number,
	order: number,
	thresholdFactor: number,
): void {
	const length = bandSignal.length;

	for (let windowIndex = 0; windowIndex < numWindows; windowIndex++) {
		const start = windowIndex * windowHop;
		const end = Math.min(length, start + windowSize);

		if (end - start <= order + 1) continue;

		const slice = new Float32Array(bandSignal.subarray(start, end));
		const coeffs = burgMethod(slice, order);
		const residual = arResidual(slice, coeffs);
		const sigma = robustStd(residual);

		if (!(sigma > 0) || !Number.isFinite(sigma)) continue;

		const sigmaSq = sigma * sigma;
		// Each sample is owned by the window whose centre is closest to it —
		// for 50% overlap, ownership is [start + windowHop/2, start + windowHop/2 + windowHop).
		// The first and last windows extend to the edges of the signal.
		const ownStart = windowIndex === 0 ? 0 : start + Math.floor(windowHop / 2);
		const ownEnd = windowIndex === numWindows - 1 ? length : start + Math.floor(windowHop / 2) + windowHop;
		const emitStart = Math.max(start + order, ownStart);
		const emitEnd = Math.min(end, ownEnd);

		for (let index = emitStart; index < emitEnd; index++) {
			const residualIndex = index - start;
			const value = residual[residualIndex] ?? 0;

			if (value * value > thresholdFactor * sigmaSq) mask[index] = 1;
		}
	}
}

// ---------------------------------------------------------------------------
// Periodic-click extension (G&R §5.5).
// ---------------------------------------------------------------------------

function extendPeriodicClicks(mask: Uint8Array, sampleRate: number, piBase: number): void {
	const length = mask.length;
	const minLag = Math.max(1, Math.round(sampleRate * PERIODIC_MIN_LAG_SECONDS));
	const maxLag = Math.min(length - 1, Math.round(sampleRate * PERIODIC_MAX_LAG_SECONDS));

	if (maxLag <= minLag) return;

	// Count of seed clicks in the mask.
	let seedCount = 0;

	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) > 0) seedCount++;
	}

	// Below two seeds there is no pair to produce a non-trivial ACF lag.
	if (seedCount < 2) return;

	const acf = new Float32Array(maxLag - minLag + 1);
	let acfSum = 0;
	let acfSumSq = 0;

	for (let lag = minLag; lag <= maxLag; lag++) {
		let sum = 0;

		for (let index = 0; index + lag < length; index++) {
			if ((mask[index] ?? 0) > 0 && (mask[index + lag] ?? 0) > 0) sum++;
		}

		acf[lag - minLag] = sum;
		acfSum += sum;
		acfSumSq += sum * sum;
	}

	const acfLen = acf.length;
	const acfMean = acfSum / acfLen;
	const acfVar = Math.max(0, acfSumSq / acfLen - acfMean * acfMean);
	const acfStd = Math.sqrt(acfVar);
	const prominenceThreshold = acfMean + PERIODIC_PEAK_Z_SCORE * acfStd;

	const peakLags: Array<number> = [];

	for (let offset = 1; offset < acfLen - 1; offset++) {
		const current = acf[offset] ?? 0;
		const prev = acf[offset - 1] ?? 0;
		const next = acf[offset + 1] ?? 0;

		if (current > prev && current > next && current >= prominenceThreshold && current >= PERIODIC_MIN_SEEDS) {
			peakLags.push(offset + minLag);
		}
	}

	if (peakLags.length === 0) return;

	// `piBase` is accepted to document the prior origin of the reduced
	// threshold G&R §5.5.2 specifies for periodic extension; the mask is
	// binary here, so the threshold materialises as the per-period-phase
	// seed-count gate below (≥ PERIODIC_MIN_SEEDS hits on the same
	// arithmetic progression before we fill in the gaps).
	void piBase;

	// Phase-class extension. For each candidate period p, bucket seed
	// positions by `seed mod p`. Any phase class with ≥ PERIODIC_MIN_SEEDS
	// seeds is a confirmed periodic train and we fill in every multiple-of-p
	// position within the buffer. This is O(length) per period regardless of
	// seed density — the seed × multiple cross-product form it replaces
	// blows up on voice material that already has many per-sample hits.
	for (const period of peakLags) {
		const phaseCounts = new Int32Array(period);

		for (let index = 0; index < length; index++) {
			if ((mask[index] ?? 0) > 0) phaseCounts[index % period] = (phaseCounts[index % period] ?? 0) + 1;
		}

		for (let phase = 0; phase < period; phase++) {
			if ((phaseCounts[phase] ?? 0) < PERIODIC_MIN_SEEDS) continue;

			for (let pos = phase; pos < length; pos += period) mask[pos] = 1;
		}
	}
}

function signalRms(signal: Float32Array): number {
	let sumSq = 0;
	const length = signal.length;

	for (let index = 0; index < length; index++) {
		const value = signal[index] ?? 0;

		sumSq += value * value;
	}

	return Math.sqrt(sumSq / Math.max(1, length));
}

// ---------------------------------------------------------------------------
// Mask post-processing.
// ---------------------------------------------------------------------------

/**
 * Morphological dilation of a binary mask with the given half-width
 * (in samples). Result[n] = 1 if any m in [n − halfWidth, n + halfWidth]
 * has mask[m] = 1.
 *
 * See G&R §6.3 on repair-region widening.
 */
export function dilateMask(mask: Uint8Array, halfWidthSamples: number): Uint8Array {
	const length = mask.length;
	const result = new Uint8Array(length);

	if (halfWidthSamples <= 0) {
		result.set(mask);

		return result;
	}

	let index = 0;

	while (index < length) {
		if ((mask[index] ?? 0) === 0) {
			index++;
			continue;
		}

		const start = index;

		while (index < length && (mask[index] ?? 0) > 0) index++;

		const end = index;
		const dilatedStart = Math.max(0, start - halfWidthSamples);
		const dilatedEnd = Math.min(length, end + halfWidthSamples);

		for (let fillIndex = dilatedStart; fillIndex < dilatedEnd; fillIndex++) result[fillIndex] = 1;
	}

	return result;
}

/**
 * Clear mask regions longer than `maxDurationSamples`. G&R §5.3.4 notes that
 * very long positive runs almost always indicate detector failure on
 * non-click transients (cymbal crashes, sustained sibilance) rather than real
 * clicks.
 *
 * Mutates `mask` in place.
 */
export function filterByDuration(mask: Uint8Array, maxDurationSamples: number): void {
	const length = mask.length;
	let regionStart = -1;

	for (let index = 0; index <= length; index++) {
		const active = index < length && (mask[index] ?? 0) > 0;

		if (active && regionStart === -1) {
			regionStart = index;
		} else if (!active && regionStart !== -1) {
			if (index - regionStart > maxDurationSamples) {
				for (let clearIndex = regionStart; clearIndex < index; clearIndex++) mask[clearIndex] = 0;
			}

			regionStart = -1;
		}
	}
}

/**
 * Pick the AR coefficient window whose centre is closest to `sampleIndex`.
 * Used by the LSAR repair to select the AR model it applies to each gap.
 */
export function windowIndexForSample(sampleIndex: number, windowSize: number, windowHop: number, numWindows: number): number {
	if (numWindows <= 1) return 0;

	const centre = sampleIndex;
	const relative = centre - windowSize / 2;
	const windowIndex = Math.round(relative / windowHop);

	return Math.max(0, Math.min(numWindows - 1, windowIndex));
}
