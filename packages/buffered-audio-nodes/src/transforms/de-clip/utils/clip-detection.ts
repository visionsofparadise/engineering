export interface ClipRegion {
	start: number;
	end: number;
}

export function detectClippedRegions(signal: Float32Array, threshold: number): Array<ClipRegion> {
	const regions: Array<ClipRegion> = [];
	let regionStart = -1;

	for (let index = 0; index < signal.length; index++) {
		const isClipped = Math.abs(signal[index] ?? 0) >= threshold;

		if (isClipped && regionStart === -1) {
			regionStart = index;
		} else if (!isClipped && regionStart !== -1) {
			regions.push({ start: regionStart, end: index });
			regionStart = -1;
		}
	}

	if (regionStart !== -1) {
		regions.push({ start: regionStart, end: signal.length });
	}

	return regions;
}

export function reconstructClippedRegion(signal: Float32Array, start: number, end: number, threshold: number): void {
	const arOrder = 16;
	const contextBefore = Math.max(0, start - arOrder * 4);
	const contextAfter = Math.min(signal.length, end + arOrder * 4);

	const contextSignal = signal.slice(contextBefore, contextAfter);
	const arCoeffs = fitArModelForDeclip(contextSignal, arOrder);

	const iterations = 5;
	const localStart = start - contextBefore;
	const localEnd = end - contextBefore;

	for (let iter = 0; iter < iterations; iter++) {
		for (let index = localStart; index < localEnd; index++) {
			let predicted = 0;

			for (let coeff = 0; coeff < arOrder; coeff++) {
				const sampleIdx = index - 1 - coeff;

				if (sampleIdx >= 0) {
					predicted += (arCoeffs[coeff] ?? 0) * (contextSignal[sampleIdx] ?? 0);
				}
			}

			const sign = (contextSignal[index] ?? 0) >= 0 ? 1 : -1;
			const constrained = Math.abs(predicted) >= threshold ? predicted : sign * threshold;

			contextSignal[index] = constrained;
		}
	}

	for (let index = localStart; index < localEnd; index++) {
		signal[contextBefore + index] = contextSignal[index] ?? 0;
	}
}

export function fitArModelForDeclip(signal: Float32Array, order: number): Float32Array {
	const autocorr = new Float32Array(order + 1);

	for (let lag = 0; lag <= order; lag++) {
		let sum = 0;

		for (let index = lag; index < signal.length; index++) {
			sum += (signal[index] ?? 0) * (signal[index - lag] ?? 0);
		}

		autocorr[lag] = sum / signal.length;
	}

	return levinsonDurbin(autocorr, order);
}

export function levinsonDurbin(autocorr: Float32Array, order: number): Float32Array {
	const coeffs = new Float32Array(order);
	const prev = new Float32Array(order);

	const r0 = autocorr[0] ?? 1;

	if (r0 === 0) return coeffs;

	const firstCoeff = (autocorr[1] ?? 0) / r0;

	coeffs[0] = firstCoeff;
	let error = r0 * (1 - firstCoeff * firstCoeff);

	for (let step = 1; step < order; step++) {
		let lambda = 0;

		for (let index = 0; index < step; index++) {
			lambda += (coeffs[index] ?? 0) * (autocorr[step - index] ?? 0);
		}

		lambda = ((autocorr[step + 1] ?? 0) - lambda) / Math.max(error, 1e-10);

		prev.set(coeffs);

		for (let index = 0; index < step; index++) {
			coeffs[index] = (prev[index] ?? 0) - lambda * (prev[step - 1 - index] ?? 0);
		}

		coeffs[step] = lambda;
		error *= 1 - lambda * lambda;

		if (error <= 0) break;
	}

	return coeffs;
}
