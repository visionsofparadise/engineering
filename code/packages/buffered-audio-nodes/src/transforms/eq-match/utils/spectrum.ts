import { stft } from "../../../utils/stft";

export function computeAverageSpectrum(signal: Float32Array, _sampleRate: number): Float32Array {
	const fftSize = 2048;
	const hopSize = fftSize / 4;
	const result = stft(signal, fftSize, hopSize);
	const halfSize = fftSize / 2 + 1;
	const avgMagnitude = new Float32Array(halfSize);

	for (let frame = 0; frame < result.frames; frame++) {
		const re = result.real[frame];
		const im = result.imag[frame];

		if (!re || !im) continue;

		for (let bin = 0; bin < halfSize; bin++) {
			const rVal = re[bin] ?? 0;
			const iVal = im[bin] ?? 0;

			avgMagnitude[bin] = (avgMagnitude[bin] ?? 0) + Math.sqrt(rVal * rVal + iVal * iVal);
		}
	}

	if (result.frames > 0) {
		for (let bin = 0; bin < halfSize; bin++) {
			avgMagnitude[bin] = (avgMagnitude[bin] ?? 0) / result.frames;
		}
	}

	return avgMagnitude;
}

export function averageSpectrumFromStft(result: { real: Array<Float32Array>; imag: Array<Float32Array>; frames: number }, halfSize: number): Float32Array {
	const avgMagnitude = new Float32Array(halfSize);

	for (let frame = 0; frame < result.frames; frame++) {
		const re = result.real[frame];
		const im = result.imag[frame];

		if (!re || !im) continue;

		for (let bin = 0; bin < halfSize; bin++) {
			const rVal = re[bin] ?? 0;
			const iVal = im[bin] ?? 0;

			avgMagnitude[bin] = (avgMagnitude[bin] ?? 0) + Math.sqrt(rVal * rVal + iVal * iVal);
		}
	}

	if (result.frames > 0) {
		for (let bin = 0; bin < halfSize; bin++) {
			avgMagnitude[bin] = (avgMagnitude[bin] ?? 0) / result.frames;
		}
	}

	return avgMagnitude;
}

export function computeCorrection(reference: Float32Array, input: Float32Array, smoothingOctaves: number): Float32Array {
	const size = Math.min(reference.length, input.length);
	const correctionDb = new Float32Array(size);

	for (let bin = 0; bin < size; bin++) {
		const refDb = 20 * Math.log10(Math.max(reference[bin] ?? 0, 1e-10));
		const inDb = 20 * Math.log10(Math.max(input[bin] ?? 0, 1e-10));

		correctionDb[bin] = refDb - inDb;
	}

	return smoothSpectrum(correctionDb, smoothingOctaves);
}

export function smoothSpectrum(spectrum: Float32Array, octaves: number): Float32Array {
	const smoothed = new Float32Array(spectrum.length);

	for (let bin = 1; bin < spectrum.length; bin++) {
		const lowerBin = Math.max(1, Math.round(bin / Math.pow(2, octaves / 2)));
		const upperBin = Math.min(spectrum.length - 1, Math.round(bin * Math.pow(2, octaves / 2)));

		let sum = 0;
		let count = 0;

		for (let neighbor = lowerBin; neighbor <= upperBin; neighbor++) {
			sum += spectrum[neighbor] ?? 0;
			count++;
		}

		smoothed[bin] = count > 0 ? sum / count : (spectrum[bin] ?? 0);
	}

	smoothed[0] = spectrum[0] ?? 0;

	return smoothed;
}
