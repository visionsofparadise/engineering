/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */
export function nlmsAdaptiveFilter(
	signal: Float32Array,
	reference: Float32Array,
	filterLength: number,
	stepSize: number,
	output: Float32Array,
): void {
	const frames = signal.length;
	const coeffs = new Float32Array(filterLength);

	let refPower = 0;

	for (let index = 0; index < frames; index++) {
		const newRef = index < reference.length ? reference[index]! : 0;

		refPower += newRef * newRef;

		const droppedIndex = index - filterLength;

		if (droppedIndex >= 0 && droppedIndex < reference.length) {
			refPower -= reference[droppedIndex]! * reference[droppedIndex]!;
		}

		if (refPower < 0) refPower = 0;

		let predicted = 0;

		for (let tap = 0; tap < filterLength; tap++) {
			const refIndex = index - tap;

			if (refIndex >= 0 && refIndex < reference.length) {
				predicted += coeffs[tap]! * reference[refIndex]!;
			}
		}

		const error = signal[index]! - predicted;

		output[index] = error;

		const mu = refPower > 1e-10 ? stepSize / (refPower + 1e-10) : 0;

		for (let tap = 0; tap < filterLength; tap++) {
			const refIndex = index - tap;

			if (refIndex >= 0 && refIndex < reference.length) {
				coeffs[tap] = coeffs[tap]! + mu * error * reference[refIndex]!;
			}
		}
	}
}
