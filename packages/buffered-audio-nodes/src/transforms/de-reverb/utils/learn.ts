/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */
// Offline whole-file Learn pass for the classical RX De-reverb algorithm
// (Nercessian & Lukin 2019 DAFx-19 §2.1 + Lukin & Todd 2007 post-filter).
//
// The Learn pass produces a reverb profile `{ alpha, beta }` where `alpha` is
// the frequency-independent smoothing coefficient of the first-order recursion
// modelling the reverberant smear (Eq. 1 of the 2019 paper) and `beta` is the
// 4-tuple of per-band wet-to-dry mixing coefficients of Eq. 2.
//
// Pipeline per `design-dereverb.md` §"α estimation" and §"β estimation":
//
//   1. Löllmann 2010 Eq. 14 sub-frame monotone-decrease pre-selection. Each
//      analysis frame of the time-domain signal is split into L = 7 equal
//      sub-frames. Frames on which sub-frame energy, max, and min are all
//      strictly decreasing across the L sub-frames survive; frames failing any
//      of the three tests are discarded as ongoing-speech (no free-decay).
//      Paper: https://www.iwaenc.org/proceedings/2010/HTML/Uploads/1076.pdf
//   2. Ratnam 2003 Eq. 11 per-frame ML decay-rate estimate. On surviving
//      frames, root-find the ML score function under the Gaussian free-decay
//      process model (s[n] = a^n · w[n] with w iid N(0, σ²)) to obtain a
//      per-sample decay factor a* ∈ (0, 1). Convert to a per-frame T̂₆₀ via
//      T̂₆₀ = 3·ln 10 / (−ln a* · f_s). Non-convergent frames are discarded.
//      Paper: https://www.ee.columbia.edu/~dpwe/papers/Ratnam03-reverb.pdf
//   3. Histogram + argmax. Surviving per-frame T̂₆₀ estimates are binned into
//      100 equal-width bins over [0.05 s, 10 s]; the argmax bin's centre is
//      the population T̂₆₀ estimate. (Löllmann 2010 uses argmax of the
//      histogram verbatim; `design-dereverb.md` Decision 2026-04-22 adopts
//      argmax as the literal reading of the DAFx-19 sentence "α is estimated
//      from a histogram of spectral decay rates".)
//   4. T̂₆₀ → α. With hop size H in samples and sample rate f_s:
//         τ = T̂₆₀ / (3·ln 10);  λ = exp(−H / (f_s · τ));  α = 1 − λ.
//   5. β per band (closed form). Run the Eq. 1 recursion forward on the STFT
//      magnitude spectrogram with the learned α: r_t = α·|Y_t| + (1−α)·r_{t−1}
//      (driven by the observed magnitude — this is an approximation to the
//      true recursion on the unknown dry magnitude ŝ; Phase 4's `computeRawGain`
//      uses the exact inversion for the gain mask). For each band b, collect
//      |Y_t(k)| / r_t(k) over (t, k) ∈ band and take the 1st-percentile. Per
//      `design-dereverb.md` §"β estimation": the non-negativity constraint
//      binds at the tightest bin, so β_b = min-over-(t,k)|Y|/r is the largest
//      β keeping every bin non-negative; the 1st-percentile is the numerically
//      robust variant against isolated spectral outliers.
//
// On degenerate output — empty post-pre-selection histogram, non-finite per-
// band β, or a learn window shorter than the minimum decay length — raise an
// error identifying the failure mode. No silent fallback defaults (see
// `design-dereverb.md` §"Learn precedence").
//
// @see Nercessian & Lukin (2019), "Speech Dereverberation Using Recurrent Neural Networks", DAFx-19, §2.1.
// @see Ratnam et al. (2003), "Blind estimation of reverberation time", JASA 114(5), Eq. 11.
// @see Löllmann, Yilmaz, Jeub, Vary (2010), "An improved algorithm for blind reverberation time estimation", IWAENC 2010, Eq. 14.

import type { StftOutput, StftResult } from "@e9g/buffered-audio-nodes-utils";
import { decimate, integerDecimationRate } from "@e9g/buffered-audio-nodes-utils";
import { bandBinGroups } from "./bands";

export interface ReverbProfile {
	readonly alpha: number;
	readonly beta: readonly [number, number, number, number];
}

export interface LearnWindow {
	readonly startFrame: number;
	readonly endFrame: number;
}

// Physical sanity bounds for T̂₆₀ (Ratnam ML output): rooms have T60 between
// 50 ms (near-anechoic) and 10 s (cathedrals / stairwells). Outside this range
// estimates are discarded.
const MIN_T60_SECONDS = 0.05;
const MAX_T60_SECONDS = 10;
// 199 bins over [0.05, 10] s gives bin width `(10 − 0.05) / 199 ≈ 0.04999 s ≈
// 0.05 s` per Löllmann §IV (the paper's bin width). The 10 s upper bound is
// an engineering extension beyond the paper's [0.1, 1.5] s validation range.
// Do not round to 200 (would give 0.0497 s; stay with the exact 0.05 s spec).
// See `design-dereverb.md` Decision "2026-04-22: Histogram bin width 0.05 s,
// range [0.05 s, 10 s]".
const HISTOGRAM_BINS = 199;

// Minimum time span of the learn window. Below this the Learn pass throws;
// matches the existing error shape for wire compatibility with the caller.
const MIN_DECAY_MS = 200;

// Löllmann sub-frame count. The paper says L ≈ 7; we pin L = 7 and slice the
// outer Löllmann analysis frame into 7 equal sub-frames.
const LOLLMANN_L = 7;

// Löllmann Table I outer analysis-frame length (M) and shift (M̂), measured
// in *downsampled* samples. At the paper's regime `f_s = 16 kHz`, `R = 5`
// (so `f_eff = 3.2 kHz`): `M = 128` downsampled samples (≈ 40 ms), `M̂ = 25`
// downsampled samples (≈ 7.8 ms), `L = 7`. For any R chosen by
// `integerDecimationRate` to keep `f_eff ≈ 3.2 kHz`, these downsampled-sample
// counts preserve the paper's time windows. See `design-dereverb.md` Decision
// "2026-04-22: Downsampling stage (Löllmann Eq. 11)".
const LOLLMANN_M_DOWNSAMPLED = 128;
const LOLLMANN_M_HAT_DOWNSAMPLED = 25;

// Löllmann partial-streak acceptance threshold. Table I of Löllmann 2010
// pins `l_min = 3`: accept a frame when the leading monotone-decrease streak
// length is ≥ 3 sub-frames, rather than requiring strict all-(L−1) monotone
// decrease. See `design-dereverb.md` Decision "2026-04-22: l_min partial-
// streak acceptance" and Löllmann 2010 Table I.
export const LOLLMANN_L_MIN = 3;

// Löllmann 2010 Table I "near-1" weight factors applied to Eq. 14a (energy),
// Eq. 14b (signed max), and Eq. 14c (signed min). 0.995 relaxes strict
// monotone decrease by 0.5 % to absorb the sub-frame-extrema sampling noise
// that is unavoidable at 18-sample sub-frames at the paper's 3.2 kHz
// downsampled rate. Three separate constants (rather than one shared) so
// listening tests can independently tune them later. See
// `design-dereverb.md` Decision "2026-04-22: Weight factors w_var, w_max,
// w_min = 0.995".
const W_VAR = 0.995;
const W_MAX = 0.995;
const W_MIN = 0.995;

// Brent-solver configuration for the Ratnam ML root-find on a ∈ (0, 1).
// A_LO is kept strictly above 0 (the score function has a removable
// singularity at a = 0 since s[0]²/a^0 = s[0]²), A_HI strictly below 1 (as
// a → 1 the recursion has infinite T60). Tolerance and iteration cap are
// generous to avoid pathological non-convergence but keep the per-frame cost
// bounded.
const BRENT_A_LO = 0.001;
const BRENT_A_HI = 0.9999;
const BRENT_TOL = 1e-6;
const BRENT_MAX_ITER = 100;

/**
 * Per-band blind reverb-profile estimation from the time-domain signal and
 * its STFT.
 *
 * `stft` is the STFT output (frame-major: bin k of frame n at index
 * n·numBins+k). `channelSamples` is the time-domain source used by the
 * Löllmann sub-frame pre-selection — Eq. 14 operates on the signal envelope
 * directly, not on the STFT magnitude. `window` restricts the frames
 * considered to `[startFrame, endFrame)`.
 *
 * Returns `{ alpha, beta }` with `alpha` scalar and `beta` the per-band
 * 4-tuple in band order `[low, lowMid, highMid, high]`.
 *
 * Throws when the pre-selection histogram is empty (no frames accepted), the
 * learn window is below `MIN_DECAY_MS`, or any per-band β is non-finite.
 */
export function learnReverbProfile(
	stft: StftResult | StftOutput,
	channelSamples: Float32Array,
	sampleRate: number,
	hopSize: number,
	window: LearnWindow,
	fftSize?: number,
): ReverbProfile {
	const real = stft.real;
	const imag = stft.imag;
	const inferredFftSize = "fftSize" in stft ? stft.fftSize : fftSize;

	if (!inferredFftSize) throw new Error("learnReverbProfile: fftSize must be provided when stft is a bare StftOutput");

	const numBins = inferredFftSize / 2 + 1;
	const totalFrames = real.length / numBins;
	const startFrame = Math.max(0, Math.floor(window.startFrame));
	const endFrame = Math.min(totalFrames, Math.ceil(window.endFrame));
	const framesInWindow = Math.max(0, endFrame - startFrame);
	const frameSeconds = hopSize / sampleRate;

	if (framesInWindow * frameSeconds < MIN_DECAY_MS / 1000) {
		throw new Error(
			`learnReverbProfile: learn window is ${(framesInWindow * frameSeconds).toFixed(3)} s, below the minimum decay length (${MIN_DECAY_MS} ms). Widen [learnStart, learnEnd] or supply a cached reverbProfile.`,
		);
	}

	const alpha = estimateAlpha(channelSamples, sampleRate, hopSize, startFrame, endFrame);
	const beta = estimateBeta(real, imag, alpha, numBins, inferredFftSize, sampleRate, startFrame, endFrame);

	for (let bandIndex = 0; bandIndex < 4; bandIndex++) {
		const value = beta[bandIndex]!;

		if (!Number.isFinite(value) || value < 0) {
			throw new Error(
				`learnReverbProfile: per-band β[${bandIndex}] = ${String(value)} is non-finite or negative. ` +
					`Widen [learnStart, learnEnd] to include more reverberant material, point the learn window at a passage with clear onsets, or supply a cached reverbProfile.`,
			);
		}
	}

	return { alpha, beta };
}

/**
 * α estimation: Löllmann pre-selection → Ratnam Eq. 11 ML per-frame → histogram
 * argmax → T̂₆₀ → α. Throws if no frames survive pre-selection or if no
 * per-frame ML estimate is finite.
 *
 * Downsampling (Löllmann Eq. 11): the source-rate signal is decimated by an
 * integer factor R = `integerDecimationRate(sampleRate)` before running the
 * Löllmann sub-frame pre-selection and Ratnam ML. The outer analysis-frame
 * length M and shift M̂ are defined at the downsampled rate per Löllmann
 * Table I (`M = 128`, `M̂ = 25` downsampled samples at `f_eff ≈ 3.2 kHz`).
 *
 * The STFT-window parameters `startFrame` / `endFrame` are translated into a
 * downsampled-sample range via the source-rate time they represent; the
 * Löllmann loop iterates inside that range.
 *
 * The α → λ conversion at the end stays at *source rate* (`sampleRate`,
 * `hopSize`): α is the recursion coefficient of the source-rate STFT-magnitude
 * model, while the ML decay-rate estimate (via `ratnamMlT60`) is a T̂₆₀ in
 * seconds — rate-agnostic — computed with `downsampledRate` matching the
 * samples actually consumed by ML. This split is load-bearing; swapping
 * either direction breaks the α recovery.
 */
function estimateAlpha(signal: Float32Array, sampleRate: number, hopSize: number, startFrame: number, endFrame: number): number {
	const rate = integerDecimationRate(sampleRate);
	const downsampled = decimate(signal, rate);
	const downsampledRate = sampleRate / rate;

	const counts = new Int32Array(HISTOGRAM_BINS);
	const binWidth = (MAX_T60_SECONDS - MIN_T60_SECONDS) / HISTOGRAM_BINS;
	let totalAccepted = 0;

	const subFrameLength = Math.floor(LOLLMANN_M_DOWNSAMPLED / LOLLMANN_L);

	// Translate the STFT-window frame range into a downsampled-sample range.
	// The Löllmann loop is independent of the STFT hop / fftSize; it iterates
	// in time within `[startTime, endTime)` at its own M̂ cadence.
	const startTime = (startFrame * hopSize) / sampleRate;
	const endTime = (endFrame * hopSize) / sampleRate;
	const dsStart = Math.max(0, Math.floor(startTime * downsampledRate));
	const dsEnd = Math.min(downsampled.length, Math.ceil(endTime * downsampledRate));

	for (let frameStart = dsStart; frameStart + LOLLMANN_M_DOWNSAMPLED <= dsEnd; frameStart += LOLLMANN_M_HAT_DOWNSAMPLED) {
		const streakLength = subFrameStreakLength(downsampled, frameStart, LOLLMANN_M_DOWNSAMPLED, LOLLMANN_L);

		if (streakLength < LOLLMANN_L_MIN) continue;

		// Löllmann adaptive ML buffer: run Ratnam Eq. 11 on exactly the
		// streak-covered window (streakLength sub-frames × sub-frame length in
		// downsampled samples). The streak begins at sub-frame 0, so the ML
		// buffer starts at `frameStart`. `ratnamMlT60` is passed
		// `downsampledRate` — the rate of the samples it consumes — so its
		// per-sample-to-per-second conversion produces a T̂₆₀ in seconds
		// consistent with the downsampled buffer.
		const nSamples = streakLength * subFrameLength;
		const t60 = ratnamMlT60(downsampled, frameStart, nSamples, downsampledRate);

		if (t60 === undefined) continue;
		if (t60 < MIN_T60_SECONDS || t60 > MAX_T60_SECONDS) continue;

		const binIndex = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((t60 - MIN_T60_SECONDS) / binWidth)));

		counts[binIndex] = (counts[binIndex] ?? 0) + 1;
		totalAccepted++;
	}

	if (totalAccepted === 0) {
		throw new Error(
			"learnReverbProfile: insufficient free-decay evidence — no frames survived Löllmann sub-frame pre-selection (Eq. 14) or no Ratnam ML estimates converged inside the physical [50 ms, 10 s] T60 range. " +
				"Widen [learnStart, learnEnd] to include more reverberant material, point the learn window at a passage with clear onsets, or supply a cached reverbProfile.",
		);
	}

	let argmaxBin = 0;
	let argmaxCount = counts[0] ?? 0;

	for (let binIndex = 1; binIndex < HISTOGRAM_BINS; binIndex++) {
		const count = counts[binIndex] ?? 0;

		if (count > argmaxCount) {
			argmaxCount = count;
			argmaxBin = binIndex;
		}
	}

	const t60Estimate = MIN_T60_SECONDS + (argmaxBin + 0.5) * binWidth;
	const tau = t60Estimate / (3 * Math.LN10);
	// α → λ conversion runs at SOURCE RATE: λ = exp(−H / (f_s · τ)), α = 1 − λ.
	// `sampleRate` and `hopSize` here are the caller-supplied source-rate STFT
	// parameters, unrelated to the downsampled Löllmann / Ratnam inner loop.
	const lambda = Math.exp(-hopSize / (sampleRate * tau));

	return 1 - lambda;
}

/**
 * Löllmann 2010 Eq. 14 leading-streak length. Slice
 * `signal[frameStart .. frameStart + fftSize)` into `L` equal sub-frames and
 * count the number of consecutive (l, l+1) transitions (starting at l = 0)
 * that pass all three Eq. 14 tests:
 *
 *   - Eq. 14a (energy): `Σ y²(l) > w_var · Σ y²(l+1)`
 *   - Eq. 14b (signed max): `max y(l) > w_max · max y(l+1)`
 *   - Eq. 14c (signed min): `min y(l) < w_min · min y(l+1)`
 *
 * Return value is the integer streak length in `{0, 1, …, L − 1}` — the
 * number of leading successful transitions before the first failure (or
 * L − 1 if no transition fails). Callers accept the frame when the streak
 * length is ≥ `LOLLMANN_L_MIN = 3` per Löllmann Table I partial-streak rule
 * (see `design-dereverb.md` Decision "2026-04-22: l_min partial-streak
 * acceptance").
 *
 * Max and min are **signed** (no `Math.abs`), which makes Eq. 14b and Eq.
 * 14c statistically distinct tests for a zero-mean decaying process: the
 * positive max shrinks toward 0 from above (`>`) while the signed min
 * shrinks toward 0 from below (`<`, i.e. less negative over time). Taking
 * absolute value would collapse both into a single magnitude test and
 * discard Eq. 14c's content — see `design-dereverb.md` Decision 2026-04-22
 * "Löllmann Eq. 14c signed-min and direction `<`".
 *
 * Loop orientation: the outer loop iterates `subIndex = 1..L−1` in time
 * order; `subIndex − 1` is the earlier sub-frame (Löllmann's `l`) and
 * `subIndex` is the next sub-frame (Löllmann's `l+1`). On the first failing
 * transition the count stops and `break` exits — the returned streak is the
 * number of successful transitions *before* the failure, not past it.
 *
 * Degenerate sub-frame length (`fftSize / subFrameCount < 2`) returns `0`.
 *
 * Weight factors `W_VAR = W_MAX = W_MIN = 0.995` (Löllmann 2010 Table I
 * near-1 weight). See `design-dereverb.md` Decision "2026-04-22: Weight
 * factors w_var, w_max, w_min = 0.995". The 0.995 relaxes strict monotone
 * decrease by 0.5 % to absorb sub-frame-extrema sampling noise at the
 * paper's 18-sample sub-frames (3.2 kHz downsampled rate).
 */
export function subFrameStreakLength(signal: Float32Array, frameStart: number, fftSize: number, subFrameCount: number): number {
	const subFrameLength = Math.floor(fftSize / subFrameCount);

	if (subFrameLength < 2) return 0;

	const energies = new Float64Array(subFrameCount);
	const maxima = new Float64Array(subFrameCount);
	const minima = new Float64Array(subFrameCount);

	for (let subIndex = 0; subIndex < subFrameCount; subIndex++) {
		const subStart = frameStart + subIndex * subFrameLength;
		const subEnd = subStart + subFrameLength;
		let energy = 0;
		let maxSigned = -Infinity;
		let minSigned = Infinity;

		for (let sampleIndex = subStart; sampleIndex < subEnd; sampleIndex++) {
			const sample = signal[sampleIndex] ?? 0;

			energy += sample * sample;
			if (sample > maxSigned) maxSigned = sample;
			if (sample < minSigned) minSigned = sample;
		}

		energies[subIndex] = energy;
		maxima[subIndex] = maxSigned;
		minima[subIndex] = minSigned;
	}

	let streak = 0;

	for (let subIndex = 1; subIndex < subFrameCount; subIndex++) {
		// Löllmann Eq. 14a (energy): `energies[l] > W_VAR · energies[l+1]`.
		const energyOk = energies[subIndex - 1]! > W_VAR * energies[subIndex]!;
		// Löllmann Eq. 14b (signed max): `maxima[l] > W_MAX · maxima[l+1]`.
		const maxOk = maxima[subIndex - 1]! > W_MAX * maxima[subIndex]!;
		// Löllmann Eq. 14c (signed min): `minima[l] < W_MIN · minima[l+1]`
		// (earlier min strictly more negative than next, weighted).
		const minOk = minima[subIndex - 1]! < W_MIN * minima[subIndex]!;

		if (!(energyOk && maxOk && minOk)) break;

		streak++;
	}

	return streak;
}

/**
 * Ratnam 2003 Eq. 11 per-frame ML decay-rate estimate over an adaptive-length
 * buffer. Under the model s[n] = a^n · w[n] with w ~ N(0, σ²) iid, the
 * concentrated-likelihood score function in a is:
 *
 *     F(a) = N · (Σ n · s[n]²/a^(2n)) / (Σ s[n]²/a^(2n))  −  Σ n
 *
 * where the sums run over n = 0 .. N−1 and Σn = N(N−1)/2. `N = nSamples`
 * is supplied by the caller — per `design-dereverb.md` Decision "2026-04-22:
 * ML buffer adapts to detected streak length", the ML buffer covers exactly
 * the Löllmann-accepted streak (`streakLength · subFrameLength` samples)
 * rather than a fixed-width analysis frame.
 *
 * The ML estimate a* is the root F(a*) = 0 in (0, 1). Sign of F: F(a → 0⁺) is
 * dominated by the n = 0 term in the denominator (s[0]² · a⁰), pushing the
 * ratio → 0 and F → −Σn < 0. F(a → 1⁻) → (N · mean(n · s[n]²) / mean(s[n]²))
 * − Σn — the centre of mass of n weighted by s[n]²; for decaying signals this
 * centre is low, making F(1⁻) negative too. But for a signal that actually
 * decays (energy concentrated at low n), there is a unique interior root
 * where F changes sign; we detect the sign change by sampling and then
 * Brent-solve.
 *
 * Returns the derived T̂₆₀ in seconds, or `undefined` on non-convergence /
 * no interior sign change / all-zero input.
 */
export function ratnamMlT60(signal: Float32Array, frameStart: number, nSamples: number, sampleRate: number): number | undefined {
	if (nSamples <= 0) return undefined;

	const squared = new Float64Array(nSamples);
	let allZero = true;

	for (let sampleIdx = 0; sampleIdx < nSamples; sampleIdx++) {
		const sample = signal[frameStart + sampleIdx] ?? 0;
		const sq = sample * sample;

		squared[sampleIdx] = sq;
		if (sq > 0) allZero = false;
	}

	if (allZero) return undefined;

	const sumN = (nSamples * (nSamples - 1)) / 2;
	const score = (decay: number): number => {
		// F(a) = N · (Σ n · s²/a^(2n)) / (Σ s²/a^(2n)) − Σ n.
		// Compute in log-space to avoid underflow for small a and large n:
		// w[n] = s² · a^(-2n) ⇒ ln w[n] = ln s² − 2n · ln a. Use the max-shifted
		// stable softmax trick: let M = max_n ln w[n], then Σ w = exp(M) · Σ
		// exp(ln w − M). The ratio (Σ n · w) / (Σ w) reduces to a single pass
		// over n weighting by the shifted exponentials.
		const lnDecay = Math.log(decay);
		let maxLogWeight = -Infinity;

		for (let sampleIdx = 0; sampleIdx < nSamples; sampleIdx++) {
			const sq = squared[sampleIdx]!;

			if (sq <= 0) continue;

			const logWeight = Math.log(sq) - 2 * sampleIdx * lnDecay;

			if (logWeight > maxLogWeight) maxLogWeight = logWeight;
		}

		if (!Number.isFinite(maxLogWeight)) return -sumN;

		let numerator = 0;
		let denominator = 0;

		for (let sampleIdx = 0; sampleIdx < nSamples; sampleIdx++) {
			const sq = squared[sampleIdx]!;

			if (sq <= 0) continue;

			const weight = Math.exp(Math.log(sq) - 2 * sampleIdx * lnDecay - maxLogWeight);

			numerator += sampleIdx * weight;
			denominator += weight;
		}

		if (denominator <= 0) return -sumN;

		return nSamples * (numerator / denominator) - sumN;
	};

	const fLo = score(BRENT_A_LO);
	const fHi = score(BRENT_A_HI);

	if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return undefined;

	// Interior sign change: F(A_LO) · F(A_HI) < 0. If both are same sign, there
	// is no root in the bracket — discard the frame.
	if (fLo * fHi > 0) return undefined;

	const root = brentSolve(score, BRENT_A_LO, BRENT_A_HI, BRENT_TOL, BRENT_MAX_ITER);

	if (root === undefined) return undefined;
	if (root <= 0 || root >= 1) return undefined;

	const delta = -Math.log(root);

	if (!(delta > 0)) return undefined;

	// Convert per-sample decay factor a* to T60 in seconds: power decays as
	// a^(2n), so log-energy slope per sample = 2·(−ln a) = 2Δ, T60 = 3·ln 10 / Δ
	// samples = 3·ln 10 / (Δ · f_s) seconds.
	return (3 * Math.LN10) / (delta * sampleRate);
}

/**
 * β estimation: run the Eq. 1 recursion forward on the STFT magnitude using
 * the learned α, collect |Y_t(k)| / r_t(k) per band, return the 1st-percentile
 * per band as the 4-tuple `[low, lowMid, highMid, high]`.
 *
 * Per `design-dereverb.md` §"β estimation": β_b = min_{(t,k)∈b} |Y|/r is the
 * analytic closed form; the 1st-percentile is the numerically robust variant
 * against isolated spectral outliers. Adopted per the design-doc note and
 * this plan's pre-execution review.
 */
function estimateBeta(
	real: Float32Array,
	imag: Float32Array,
	alpha: number,
	numBins: number,
	fftSize: number,
	sampleRate: number,
	startFrame: number,
	endFrame: number,
): readonly [number, number, number, number] {
	const bands = bandBinGroups(fftSize, sampleRate);
	const bandRanges = [bands.low, bands.lowMid, bands.highMid, bands.high] as const;
	const bandSamples: Array<Array<number>> = [[], [], [], []];
	const rPrev = new Float32Array(numBins);

	for (let frameIndex = startFrame; frameIndex < endFrame; frameIndex++) {
		const rowOffset = frameIndex * numBins;

		for (let bin = 0; bin < numBins; bin++) {
			const re = real[rowOffset + bin] ?? 0;
			const im = imag[rowOffset + bin] ?? 0;
			const magnitude = Math.sqrt(re * re + im * im);
			const rCurrent = alpha * magnitude + (1 - alpha) * (rPrev[bin] ?? 0);

			rPrev[bin] = rCurrent;

			if (rCurrent <= 1e-12) continue;

			const ratio = magnitude / rCurrent;

			if (!Number.isFinite(ratio)) continue;

			for (let bandIndex = 0; bandIndex < 4; bandIndex++) {
				const [lo, hi] = bandRanges[bandIndex]!;

				if (bin >= lo && bin < hi) {
					bandSamples[bandIndex]!.push(ratio);
					break;
				}
			}
		}
	}

	const beta: [number, number, number, number] = [0, 0, 0, 0];

	for (let bandIndex = 0; bandIndex < 4; bandIndex++) {
		const samples = bandSamples[bandIndex]!;

		if (samples.length === 0) {
			beta[bandIndex] = NaN;
			continue;
		}

		samples.sort((left, right) => left - right);

		// 1st-percentile: index floor(0.01 · (N − 1)).
		const percentileIndex = Math.floor(0.01 * (samples.length - 1));

		beta[bandIndex] = samples[percentileIndex]!;
	}

	return beta;
}

/**
 * Brent's root-finding method for a continuous scalar function with a known
 * sign-changing bracket [lo, hi]. Combines bisection (always-convergent
 * fallback) with inverse-quadratic / secant steps (superlinear convergence
 * where possible). Capped at `maxIter` iterations to guarantee termination
 * on pathological inputs; returns `undefined` on non-convergence.
 *
 * Implementation follows Brent (1973) "Algorithms for Minimization Without
 * Derivatives", §4.
 */
function brentSolve(func: (x: number) => number, lo: number, hi: number, tol: number, maxIter: number): number | undefined {
	let xa = lo;
	let xb = hi;
	let fa = func(xa);
	let fb = func(xb);

	if (!Number.isFinite(fa) || !Number.isFinite(fb)) return undefined;
	if (fa === 0) return xa;
	if (fb === 0) return xb;
	if (fa * fb > 0) return undefined;

	if (Math.abs(fa) < Math.abs(fb)) {
		[xa, xb] = [xb, xa];
		[fa, fb] = [fb, fa];
	}

	let xc = xa;
	let fc = fa;
	let step = xb - xa;
	let prevStep = step;
	let useBisection = true;

	for (let iter = 0; iter < maxIter; iter++) {
		if (fb === 0) return xb;
		if (Math.abs(fc) < Math.abs(fb)) {
			xa = xb;
			xb = xc;
			xc = xa;
			fa = fb;
			fb = fc;
			fc = fa;
		}

		const tolAct = 2 * Number.EPSILON * Math.abs(xb) + 0.5 * tol;
		const mid = 0.5 * (xc - xb);

		if (Math.abs(mid) <= tolAct || fb === 0) return xb;

		if (Math.abs(prevStep) >= tolAct && Math.abs(fa) > Math.abs(fb)) {
			const ss = fb / fa;
			let pp: number;
			let qq: number;

			if (xa === xc) {
				// Secant step.
				pp = 2 * mid * ss;
				qq = 1 - ss;
			} else {
				// Inverse-quadratic interpolation.
				const qa = fa / fc;
				const rb = fb / fc;

				pp = ss * (2 * mid * qa * (qa - rb) - (xb - xa) * (rb - 1));
				qq = (qa - 1) * (rb - 1) * (ss - 1);
			}

			if (pp > 0) qq = -qq;

			pp = Math.abs(pp);

			const min1 = 3 * mid * qq - Math.abs(tolAct * qq);
			const min2 = Math.abs(prevStep * qq);

			if (2 * pp < Math.min(min1, min2)) {
				prevStep = step;
				step = pp / qq;
				useBisection = false;
			} else {
				useBisection = true;
			}
		} else {
			useBisection = true;
		}

		if (useBisection) {
			step = mid;
			prevStep = step;
		}

		xa = xb;
		fa = fb;

		if (Math.abs(step) > tolAct) {
			xb = xb + step;
		} else {
			xb = xb + (mid > 0 ? tolAct : -tolAct);
		}

		fb = func(xb);

		if (!Number.isFinite(fb)) return undefined;

		if (fb * fc > 0) {
			xc = xa;
			fc = fa;
			step = xb - xa;
			prevStep = step;
		}
	}

	return undefined;
}
