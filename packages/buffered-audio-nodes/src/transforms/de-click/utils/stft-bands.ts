// STFT bin-group decomposition for G&R §5.7 multiband detection. Replaces the
// previously-shipped 4-band biquad filterbank with an exact bin-resolution
// split matching the de-reverb node's band layout (0 / 500 / 2k / 8k / Nyquist).
//
// For each band we zero every STFT bin outside the band's [startBin, endBin)
// range and inverse-transform to recover the band-limited time-domain signal.
// The band residual is then run through the short-window AR detector in
// detection.ts.
//
// Bin-resolution filtering is exact at the FFT grid — no filterbank-edge
// Butterworth approximation. Cascaded STFT -> bin-zero -> iSTFT is the natural
// companion to the Bayesian per-band prior combination described in
// design-declick.md §3.

import { istft, stft, type FftBackend, type StftResult } from "@e9g/buffered-audio-nodes-utils";

export type BandKey = "low" | "lowMid" | "highMid" | "high";

export const BAND_KEYS: ReadonlyArray<BandKey> = ["low", "lowMid", "highMid", "high"];

export interface BandBinRange {
	readonly low: readonly [number, number];
	readonly lowMid: readonly [number, number];
	readonly highMid: readonly [number, number];
	readonly high: readonly [number, number];
}

export interface BandSignals {
	readonly low: Float32Array;
	readonly lowMid: Float32Array;
	readonly highMid: Float32Array;
	readonly high: Float32Array;
}

/**
 * Band-edge layout: [0, 500, 2000, 8000, Nyquist] Hz. Edges are quantised to
 * the nearest STFT bin; at 48 kHz / fftSize=2048 this is ~23.4 Hz quantisation.
 *
 * Ranges are `[startBin, endBin)` with endBin exclusive. `high` terminates at
 * the Nyquist bin index `fftSize/2 + 1` so DC and Nyquist are each covered
 * exactly once across the four bands.
 */
export function bandBinGroups(fftSize: number, sampleRate: number): BandBinRange {
	const binFreq = sampleRate / fftSize;
	const nyquistBin = fftSize / 2 + 1;

	const toBin = (edgeHz: number): number => Math.max(0, Math.min(nyquistBin, Math.round(edgeHz / binFreq)));

	return {
		low: [toBin(0), toBin(500)] as const,
		lowMid: [toBin(500), toBin(2000)] as const,
		highMid: [toBin(2000), toBin(8000)] as const,
		high: [toBin(8000), nyquistBin] as const,
	};
}

/**
 * Split a mono signal into four band-limited time-domain signals via STFT →
 * bin zeroing → iSTFT.
 *
 * The signal is zero-padded at the tail up to the nearest STFT frame boundary
 * so the final frames are fully covered by the Hann window. The reconstructed
 * per-band signal is truncated back to `signal.length` before return — iSTFT
 * edge scaling at the tail is the cost of exact bin-resolution filtering.
 *
 * Uses the JS FFT backend by default; pass a pre-initialised backend for
 * accelerated paths.
 */
export function splitByBinGroups(
	signal: Float32Array,
	sampleRate: number,
	fftSize: number,
	hopSize: number,
	backend?: FftBackend,
	fftAddonOptions?: { vkfftPath?: string; fftwPath?: string },
): BandSignals {
	const numBins = fftSize / 2 + 1;
	const length = signal.length;
	// Pad the working length so every input sample sits under full Hann COLA
	// coverage, matching the de-reverb node's tail-padding strategy.
	const paddedLength = Math.max(length + fftSize, fftSize);
	const alignedLength = paddedLength + ((hopSize - ((paddedLength - fftSize) % hopSize)) % hopSize);
	const padded = new Float32Array(alignedLength);

	padded.set(signal);

	const stftResult = stft(padded, fftSize, hopSize, undefined, backend, fftAddonOptions);
	const bands = bandBinGroups(fftSize, sampleRate);

	const reconstructBand = (range: readonly [number, number]): Float32Array => {
		const real = new Float32Array(stftResult.real.length);
		const imag = new Float32Array(stftResult.imag.length);
		const [startBin, endBin] = range;

		for (let frame = 0; frame < stftResult.frames; frame++) {
			const rowOffset = frame * numBins;

			for (let bin = startBin; bin < endBin; bin++) {
				real[rowOffset + bin] = stftResult.real[rowOffset + bin] ?? 0;
				imag[rowOffset + bin] = stftResult.imag[rowOffset + bin] ?? 0;
			}
		}

		const maskedResult: StftResult = {
			real,
			imag,
			frames: stftResult.frames,
			fftSize,
		};
		const bandSignal = istft(maskedResult, hopSize, alignedLength, backend, fftAddonOptions);

		return bandSignal.subarray(0, length);
	};

	return {
		low: reconstructBand(bands.low),
		lowMid: reconstructBand(bands.lowMid),
		highMid: reconstructBand(bands.highMid),
		high: reconstructBand(bands.high),
	};
}
