// Burg's method for AR coefficient estimation plus supporting residual and
// robust-sigma helpers. Used by the AR-residual Declick detector (see
// design-declick.md). Burg is chosen over autocorrelation-method Levinson-Durbin
// because it does not require windowing the signal and guarantees stable
// minimum-phase AR filters — both properties are correctness-relevant for
// per-chunk click detection.
//
// Additionally, this module exposes `yuleWalkerLevinsonDurbin` for the
// detector's Oudre 2015 path (Oudre §2.2, Eqs. 10–11). Oudre specifies
// Yule-Walker + Levinson-Durbin recursion, which produces both the AR
// coefficients and the excitation standard-deviation σ̂_e as a side effect
// of the recursion. The single-threshold rule `|d[n]| > K · σ̂_e`
// (Oudre §2.3 Eq. 14) consumes σ̂_e directly, so we return it alongside the
// coefficients rather than re-deriving it from the residual.

const ZERO_VARIANCE_THRESHOLD = 1e-12;

/**
 * Burg's algorithm for AR coefficient estimation.
 *
 * Returns a Float32Array of length `order` where index i stores the coefficient
 * a[i+1] for lag (i+1). The prediction model is
 *   pred[n] = -Σ_{k=1..order} a[k] · signal[n-k]
 * so the residual is
 *   resid[n] = signal[n] + Σ_{k=1..order} a[k] · signal[n-k]
 *
 * Throws if `signal.length < order + 1`.
 *
 * If the signal variance is below ZERO_VARIANCE_THRESHOLD, returns all-zero
 * coefficients so the caller's residual equals the signal (detection falls
 * through to no-detection).
 */
export function burgMethod(signal: Float32Array, order: number): Float32Array {
	if (order < 1) throw new Error(`burgMethod: order must be >= 1 (got ${order})`);
	if (signal.length < order + 1) throw new Error(`burgMethod: signal length ${signal.length} must be >= order + 1 = ${order + 1}`);

	const length = signal.length;

	// Zero-variance guard: Burg's denominator sums vanish on silent input, which
	// would produce NaN reflection coefficients. Return zeros so the caller's
	// residual equals the signal.
	let sumSq = 0;

	for (let index = 0; index < length; index++) {
		const sample = signal[index] ?? 0;

		sumSq += sample * sample;
	}

	if (sumSq / length < ZERO_VARIANCE_THRESHOLD) {
		return new Float32Array(order);
	}

	// Working buffers: forwardErr = forward prediction errors, backwardErr = backward prediction errors.
	// Initialised to the signal itself (zeroth-order prediction).
	const forwardErr = new Float64Array(length);
	const backwardErr = new Float64Array(length);

	for (let index = 0; index < length; index++) {
		const sample = signal[index] ?? 0;

		forwardErr[index] = sample;
		backwardErr[index] = sample;
	}

	// Current AR coefficient vector in Float64 for numerical stability during updates.
	const coeffs = new Float64Array(order);
	const coeffsPrev = new Float64Array(order);

	for (let stage = 0; stage < order; stage++) {
		// Compute reflection coefficient km from current forward and backward errors.
		let numerator = 0;
		let denominator = 0;

		for (let index = stage + 1; index < length; index++) {
			const fi = forwardErr[index] ?? 0;
			const biPrev = backwardErr[index - 1] ?? 0;

			numerator += fi * biPrev;
			denominator += fi * fi + biPrev * biPrev;
		}

		// Guard against denominator underflow (can happen if the signal is
		// almost perfectly predicted by the current model — residuals are zero).
		const km = denominator > 1e-30 ? (-2 * numerator) / denominator : 0;

		// Save previous coefficients for the update.
		for (let index = 0; index < stage; index++) coeffsPrev[index] = coeffs[index] ?? 0;

		// Update coefficients: coeffs_new[i] = coeffs_prev[i] + km * coeffs_prev[stage-1-i] for i in [0, stage-1].
		for (let index = 0; index < stage; index++) {
			coeffs[index] = (coeffsPrev[index] ?? 0) + km * (coeffsPrev[stage - 1 - index] ?? 0);
		}

		coeffs[stage] = km;

		// Update forward and backward prediction errors in place (iterate from
		// the top to avoid overwriting values still needed).
		for (let index = length - 1; index >= stage + 1; index--) {
			const fi = forwardErr[index] ?? 0;
			const biPrev = backwardErr[index - 1] ?? 0;

			forwardErr[index] = fi + km * biPrev;
			backwardErr[index] = biPrev + km * fi;
		}
	}

	const result = new Float32Array(order);

	for (let index = 0; index < order; index++) result[index] = coeffs[index] ?? 0;

	return result;
}

/**
 * Compute the AR residual from a signal and its estimated AR coefficients.
 *
 * resid[n] = signal[n] + Σ_{k=1..order} coeffs[k-1] · signal[n-k]   for n >= order
 * resid[n] = 0                                                       for n < order
 *
 * The sign convention matches `burgMethod`: coefficients returned by `burgMethod`
 * are the AR coefficients a[k] such that the prediction is -Σ a[k]·x[n-k], so the
 * residual is signal[n] minus prediction = signal[n] + Σ a[k]·signal[n-k].
 */
export function arResidual(signal: Float32Array, coeffs: Float32Array): Float32Array {
	const order = coeffs.length;
	const length = signal.length;
	const residual = new Float32Array(length);

	for (let index = order; index < length; index++) {
		let acc = signal[index] ?? 0;

		for (let lag = 0; lag < order; lag++) {
			acc += (coeffs[lag] ?? 0) * (signal[index - lag - 1] ?? 0);
		}

		residual[index] = acc;
	}

	return residual;
}

/**
 * Robust standard deviation via the Median Absolute Deviation, with centring.
 *   σ̂ = 1.4826 · median(|e − median(e)|)
 *
 * G&R §5.2.3 is explicit that AR residuals from short-window fits are not
 * guaranteed zero-mean, especially at voice onsets — the median must be
 * subtracted. The scaling 1.4826 makes σ̂ a consistent estimator of the
 * Gaussian σ. MAD is chosen over plain std so click outliers in the residual
 * do not inflate σ̂ and defeat the detection threshold.
 */
export function robustStd(residual: Float32Array): number {
	const length = residual.length;

	if (length === 0) return 0;

	const copyForMedian = new Float32Array(residual);
	const centre = medianOfCopy(copyForMedian);

	const deviations = new Float32Array(length);

	for (let index = 0; index < length; index++) deviations[index] = Math.abs((residual[index] ?? 0) - centre);

	const medianAbs = medianOfCopy(deviations);

	return 1.4826 * medianAbs;
}

/**
 * Yule-Walker autocorrelation estimation plus Levinson-Durbin recursion.
 *
 * Implements Oudre 2015 §2.2 Eqs. (10)–(11). Unlike Burg, Yule-Walker does
 * window the signal (autocorrelation method), which biases the spectrum at
 * the edges but is the estimator Oudre explicitly specifies — and crucially,
 * the Levinson-Durbin recursion yields the excitation standard-deviation
 * σ̂_e as a by-product, which Oudre's single-threshold rule consumes.
 *
 * Returns `{ coeffs, sigmaE }` where `coeffs[k-1]` is the AR coefficient at
 * lag k under the same sign convention as `burgMethod` (prediction error
 * filter 1 + Σ_k a_k z^{-k}), and `sigmaE` is the estimated excitation
 * standard-deviation. On zero-variance input returns zero coefficients and
 * σ̂_e = 0.
 *
 * Throws if `signal.length < order + 1`.
 */
export function yuleWalkerLevinsonDurbin(signal: Float32Array, order: number): { coeffs: Float32Array; sigmaE: number } {
	if (order < 1) throw new Error(`yuleWalkerLevinsonDurbin: order must be >= 1 (got ${order})`);
	if (signal.length < order + 1) throw new Error(`yuleWalkerLevinsonDurbin: signal length ${signal.length} must be >= order + 1 = ${order + 1}`);

	const length = signal.length;

	// Autocorrelation estimator (Oudre Eq. 10): R̂(τ) = (1/N) · Σ x[k] · x[k−τ].
	const autocorr = new Float64Array(order + 1);

	for (let lag = 0; lag <= order; lag++) {
		let sum = 0;

		for (let index = lag; index < length; index++) {
			sum += (signal[index] ?? 0) * (signal[index - lag] ?? 0);
		}

		autocorr[lag] = sum / length;
	}

	const r0 = autocorr[0] ?? 0;

	if (r0 < ZERO_VARIANCE_THRESHOLD) {
		return { coeffs: new Float32Array(order), sigmaE: 0 };
	}

	// Levinson-Durbin recursion. Produces AR coefficients a[1..p] and the
	// prediction-error variance E_p at each stage. E_0 = R̂(0), and
	// E_p = E_{p-1} · (1 − k_p²) with k_p the reflection coefficient.
	const coeffsCurrent = new Float64Array(order);
	const coeffsPrev = new Float64Array(order);
	let error = r0;

	for (let stage = 0; stage < order; stage++) {
		let acc = autocorr[stage + 1] ?? 0;

		for (let inner = 0; inner < stage; inner++) {
			acc += (coeffsPrev[inner] ?? 0) * (autocorr[stage - inner] ?? 0);
		}

		const reflection = error > 1e-30 ? -acc / error : 0;

		coeffsCurrent[stage] = reflection;

		for (let inner = 0; inner < stage; inner++) {
			coeffsCurrent[inner] = (coeffsPrev[inner] ?? 0) + reflection * (coeffsPrev[stage - 1 - inner] ?? 0);
		}

		error = error * (1 - reflection * reflection);

		for (let inner = 0; inner <= stage; inner++) coeffsPrev[inner] = coeffsCurrent[inner] ?? 0;
	}

	const result = new Float32Array(order);

	for (let index = 0; index < order; index++) result[index] = coeffsCurrent[index] ?? 0;

	// Clamp to zero in case of numerical drift on near-silent segments.
	const sigmaE = error > 0 ? Math.sqrt(error) : 0;

	return { coeffs: result, sigmaE };
}

function medianOfCopy(values: Float32Array): number {
	const length = values.length;

	if (length === 0) return 0;

	// Sort a Float32Array copy. Float32Array.sort uses numeric compare by
	// default; on whole-file Declick buffers (millions of samples) this is
	// substantially faster than Array.from + Array.sort. AR residuals from our
	// Burg implementation are finite by construction, so the NaN-handling
	// caveat doesn't apply here.
	const copy = new Float32Array(values);

	copy.sort();

	const mid = length >>> 1;

	if ((length & 1) === 1) return copy[mid] ?? 0;

	return ((copy[mid - 1] ?? 0) + (copy[mid] ?? 0)) / 2;
}
