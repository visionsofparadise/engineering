/**
 * Four-band STFT bin layout used by the de-reverb node.
 *
 * Each band is a `[startBin, endBin)` range (inclusive start, exclusive end)
 * over the positive-frequency half of the spectrum. Edges are quantized to the
 * nearest STFT bin at the configured FFT size. At 48 kHz / 4096-point FFT this
 * is sub-perceptual quantization (~11.7 Hz bin width).
 *
 * Band edges (Hz): [0, 500, 2000, 8000, sampleRate/2].
 */
export interface BandBinRange {
	readonly low: readonly [number, number];
	readonly lowMid: readonly [number, number];
	readonly highMid: readonly [number, number];
	readonly high: readonly [number, number];
}

export function bandBinGroups(fftSize: number, sampleRate: number): BandBinRange {
	const binFreq = sampleRate / fftSize;
	const nyquistBin = fftSize / 2 + 1;

	const clamp = (bin: number): number => Math.max(0, Math.min(nyquistBin, bin));
	const toBin = (edgeHz: number): number => clamp(Math.round(edgeHz / binFreq));

	const lowStart = toBin(0);
	const lowMidStart = toBin(500);
	const highMidStart = toBin(2000);
	const highStart = toBin(8000);

	// `high` ends at the Nyquist bin (inclusive of DC + Nyquist) per design doc.
	return {
		low: [lowStart, lowMidStart] as const,
		lowMid: [lowMidStart, highMidStart] as const,
		highMid: [highMidStart, highStart] as const,
		high: [highStart, nyquistBin] as const,
	};
}
