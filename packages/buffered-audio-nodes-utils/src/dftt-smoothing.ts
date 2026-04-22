/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loop with bounds-checked typed array access */

import { createFftWorkspace, fft, hanningWindow, ifft, type FftWorkspace } from "./stft";
import { getFftAddon, type FftBackend } from "./fft-backend";

/**
 * DFT-thresholding (DFTT) post-smoothing of a 2D gain mask.
 *
 * Second-stage post-processing after NLM smoothing. Analyzes the raw gain
 * mask in 32×16 (frequency × time) blocks with a 2D Hann window, applies
 * spectral-subtraction-style attenuation in 2D-frequency space using the
 * NLM-smoothed mask for SNR estimation, then reconstructs via inverse 2D-FFT
 * and overlap-add. Restores transient detail that NLM alone may oversmooth.
 *
 * When a native FFT addon is available (fftw or vkfft) the 2D-FFT is
 * performed as one batched `batchFft2D` / `batchIfft2D` call per invocation,
 * replacing the ~15M per-chunk JS row/column 1D FFTs (see design-de-bleed.md
 * 2026-04-21 "DFTT batched via addon 2D FFT"). When no addon is loadable,
 * falls back to the original JS implementation (two passes of 1D-FFT).
 *
 * @see Lukin, A. & Todd, J. (2007). "Suppression of Musical Noise Artifacts
 *   in Audio Noise Reduction by Adaptive 2D Filtering." 123rd AES Convention,
 *   Paper 7168. PDF: http://imaging.cs.msu.ru/pub/MusicalNoise07.pdf
 * @see Buades, A., Coll, B., Morel, J. (2005). "Image Denoising By Non-Local
 *   Averaging." IEEE ICASSP 2005, vol. 2, pp. 25–28.
 */

/**
 * Parameters for the DFTT smoothing stage.
 *
 * Default values match Lukin & Todd 2007, Section 4.3 exactly.
 */
export interface DfttParams {
	/** Block size along the frequency axis (32 bins). */
	readonly blockFreq: number;
	/** Block size along the time axis (16 frames). */
	readonly blockTime: number;
	/** Hop size along the frequency axis (8 bins). */
	readonly hopFreq: number;
	/** Hop size along the time axis (4 frames). */
	readonly hopTime: number;
	/** Spectral subtraction threshold, same scale as NlmParams.threshold. */
	readonly threshold: number;
}

/**
 * Complex FFT of a real-array pair using linearity of the DFT.
 *
 * DFT(z_re + j·z_im) = DFT(z_re) + j·DFT(z_im), so:
 *   outRe[k] = DFT(z_re).re[k] - DFT(z_im).im[k]
 *   outIm[k] = DFT(z_re).im[k] + DFT(z_im).re[k]
 */
function complexFft(
	inRe: Float32Array,
	inIm: Float32Array,
	outRe: Float32Array,
	outIm: Float32Array,
	workspaceA: FftWorkspace,
	workspaceB: FftWorkspace,
): void {
	const { re: reOfRe, im: imOfRe } = fft(inRe, workspaceA);
	const { re: reOfIm, im: imOfIm } = fft(inIm, workspaceB);
	const size = inRe.length;

	for (let ii = 0; ii < size; ii++) {
		outRe[ii] = reOfRe[ii]! - imOfIm[ii]!;
		outIm[ii] = imOfRe[ii]! + reOfIm[ii]!;
	}
}

/**
 * Apply DFT-thresholding (DFTT) post-smoothing to a gain mask.
 *
 * Routes to the native batched-2D-FFT path when an FFT addon is loadable for
 * the pipeline's selected backend, else to the JS fallback. Both paths are
 * numerically equivalent (Wiener rule in 2D-frequency, 2D Hann analysis/
 * synthesis, 32×16 blocks, 8/4 hops).
 *
 * @param nlmSmoothed     - Output of applyNlmSmoothing — used for SNR estimation.
 * @param rawMask         - Pre-NLM gain mask — subject to analysis and synthesis.
 * @param numFrames       - Number of STFT frames.
 * @param numBins         - Number of frequency bins per frame.
 * @param dfttOptions     - DFTT algorithm parameters (see DfttParams).
 * @param output          - Pre-allocated output array, same shape as rawMask.
 * @param fftBackend      - Backend selected by the pipeline; undefined forces JS.
 * @param fftAddonOptions - Addon paths (same shape the main STFT receives).
 *
 * @see Lukin, A. & Todd, J. (2007). "Suppression of Musical Noise Artifacts
 *   in Audio Noise Reduction by Adaptive 2D Filtering." 123rd AES Convention,
 *   Paper 7168. PDF: http://imaging.cs.msu.ru/pub/MusicalNoise07.pdf
 */
export function applyDfttSmoothing(
	nlmSmoothed: Float32Array,
	rawMask: Float32Array,
	numFrames: number,
	numBins: number,
	dfttOptions: DfttParams,
	output: Float32Array,
	fftBackend: FftBackend | undefined,
	fftAddonOptions: { vkfftPath?: string; fftwPath?: string } | undefined,
): void {
	const addon = fftBackend ? getFftAddon(fftBackend, fftAddonOptions) : null;

	if (!addon || typeof addon.batchFft2D !== "function") {
		applyDfttSmoothingJs(nlmSmoothed, rawMask, numFrames, numBins, dfttOptions, output);

		return;
	}

	const { blockFreq, blockTime, hopFreq, hopTime, threshold } = dfttOptions;

	// 2D Hann analysis/synthesis window (separable outer product). Same as JS path.
	const winFreq = hanningWindow(blockFreq, false);
	const winTime = hanningWindow(blockTime, false);
	const win2d = new Float32Array(blockTime * blockFreq);

	for (let tf = 0; tf < blockTime; tf++) {
		for (let bf = 0; bf < blockFreq; bf++) {
			win2d[tf * blockFreq + bf] = winTime[tf]! * winFreq[bf]!;
		}
	}

	// Match the JS loop exactly: blocks start at multiples of hopTime/hopFreq
	// up to (but not including) numFrames / numBins. For each starting block the
	// block contents are read with boundary clamping on the source indices.
	const blocksPerFrame = Math.ceil(numFrames / hopTime);
	const blocksPerBin = Math.ceil(numBins / hopFreq);
	const totalBlocks = blocksPerFrame * blocksPerBin;
	const blockSize = blockTime * blockFreq;
	const complexBinsPerRow = blockFreq / 2 + 1;
	const complexBlockSize = blockTime * complexBinsPerRow;

	// Block-major batched input buffers; inside each block row-major with
	// blockTime (rows) outer and blockFreq (cols) inner — matches the addon's
	// batchFft2D(input, rows=blockTime, cols=blockFreq, batchCount) layout.
	const rawBatch = new Float32Array(totalBlocks * blockSize);
	const nlmBatch = new Float32Array(totalBlocks * blockSize);

	for (let frameIdx = 0; frameIdx < blocksPerFrame; frameIdx++) {
		const frameStart = frameIdx * hopTime;

		for (let binIdx = 0; binIdx < blocksPerBin; binIdx++) {
			const binStart = binIdx * hopFreq;
			const blockIdx = frameIdx * blocksPerBin + binIdx;
			const blockOffset = blockIdx * blockSize;

			for (let tf = 0; tf < blockTime; tf++) {
				const srcFrame = frameStart + tf < numFrames ? frameStart + tf : numFrames - 1;

				for (let bf = 0; bf < blockFreq; bf++) {
					const srcBin = binStart + bf < numBins ? binStart + bf : numBins - 1;
					const winVal = win2d[tf * blockFreq + bf]!;
					const srcPos = srcFrame * numBins + srcBin;
					const dstPos = blockOffset + tf * blockFreq + bf;

					rawBatch[dstPos] = rawMask[srcPos]! * winVal;
					nlmBatch[dstPos] = nlmSmoothed[srcPos]! * winVal;
				}
			}
		}
	}

	// One forward 2D FFT per batched mask.
	const rawFft = addon.batchFft2D(rawBatch, blockTime, blockFreq, totalBlocks);
	const nlmFft = addon.batchFft2D(nlmBatch, blockTime, blockFreq, totalBlocks);

	// Wiener suppression in 2D-frequency (Lukin & Todd 2007 §4.2):
	//   G[k] = |nlm|² / (|nlm|² + σ²)
	// Applied in-place on rawFft.re / rawFft.im so the iFFT reconstructs the
	// gain-shaped raw mask block.
	const sigmaSq = threshold * threshold;
	const totalComplex = totalBlocks * complexBlockSize;
	const rawRe = rawFft.re;
	const rawIm = rawFft.im;
	const nlmRe = nlmFft.re;
	const nlmIm = nlmFft.im;

	for (let flatIdx = 0; flatIdx < totalComplex; flatIdx++) {
		const nRe = nlmRe[flatIdx]!;
		const nIm = nlmIm[flatIdx]!;
		const nMagSq = nRe * nRe + nIm * nIm;
		const gain = nMagSq / (nMagSq + sigmaSq);

		rawRe[flatIdx] = rawRe[flatIdx]! * gain;
		rawIm[flatIdx] = rawIm[flatIdx]! * gain;
	}

	// One inverse 2D FFT for the whole batch.
	const synth = addon.batchIfft2D(rawRe, rawIm, blockTime, blockFreq, totalBlocks);

	// Overlap-add with the synthesis window (same win2d applied at OLA time,
	// so effective window is analysis·synthesis = win² per the JS path).
	const accumulator = new Float32Array(numFrames * numBins);
	const windowSumSq = new Float32Array(numFrames * numBins);

	for (let frameIdx = 0; frameIdx < blocksPerFrame; frameIdx++) {
		const frameStart = frameIdx * hopTime;

		for (let binIdx = 0; binIdx < blocksPerBin; binIdx++) {
			const binStart = binIdx * hopFreq;
			const blockIdx = frameIdx * blocksPerBin + binIdx;
			const blockOffset = blockIdx * blockSize;

			for (let tf = 0; tf < blockTime; tf++) {
				const destFrame = frameStart + tf;

				if (destFrame >= numFrames) break;

				for (let bf = 0; bf < blockFreq; bf++) {
					const destBin = binStart + bf;

					if (destBin >= numBins) break;

					const winVal = win2d[tf * blockFreq + bf]!;
					const destPos = destFrame * numBins + destBin;
					const srcVal = synth[blockOffset + tf * blockFreq + bf]!;

					accumulator[destPos] = accumulator[destPos]! + srcVal * winVal;
					windowSumSq[destPos] = windowSumSq[destPos]! + winVal * winVal;
				}
			}
		}
	}

	// Normalise and clamp to [0,1] — DFTT input/output is a gain mask.
	for (let flatIdx = 0; flatIdx < numFrames * numBins; flatIdx++) {
		const ws = windowSumSq[flatIdx]!;

		if (ws > 1e-8) {
			const normalisedVal = accumulator[flatIdx]! / ws;

			output[flatIdx] = normalisedVal < 0 ? 0 : normalisedVal > 1 ? 1 : normalisedVal;
		} else {
			output[flatIdx] = rawMask[flatIdx]!;
		}
	}
}

/**
 * JS fallback — original row/column 1D FFT implementation. Kept verbatim for
 * environments without a loadable FFT addon (unit tests and no-addon deploys).
 *
 * Per Lukin & Todd 2007 §4.2, this stage:
 *   1. Extracts overlapping 32×16 blocks from `rawMask` with a 2D Hann window.
 *   2. Applies a 2D-FFT to each block (rows then columns).
 *   3. Computes a Wiener-style gain in 2D-frequency space, using the NLM-
 *      smoothed block to estimate the "signal" and the raw block for the
 *      full magnitude, suppressing components that are noise-like.
 *   4. Inverse 2D-FFT and overlap-add into the output.
 */
function applyDfttSmoothingJs(
	nlmSmoothed: Float32Array,
	rawMask: Float32Array,
	numFrames: number,
	numBins: number,
	dfttOptions: DfttParams,
	output: Float32Array,
): void {
	const { blockFreq, blockTime, hopFreq, hopTime, threshold } = dfttOptions;

	// 2D Hann analysis/synthesis window (separable outer product)
	const winFreq = hanningWindow(blockFreq, false);
	const winTime = hanningWindow(blockTime, false);
	const win2d = new Float32Array(blockTime * blockFreq);

	for (let tf = 0; tf < blockTime; tf++) {
		for (let bf = 0; bf < blockFreq; bf++) {
			win2d[tf * blockFreq + bf] = winTime[tf]! * winFreq[bf]!;
		}
	}

	// Overlap-add accumulator and window-sum-of-squares for normalisation
	const accumulator = new Float32Array(numFrames * numBins);
	const windowSumSq = new Float32Array(numFrames * numBins);

	// Working buffers — allocated once, reused per block
	const blockRaw = new Float32Array(blockTime * blockFreq);
	const blockNlm = new Float32Array(blockTime * blockFreq);

	// Row-FFT output buffers [t * blockFreq + f]
	const rawRowRe = new Float32Array(blockTime * blockFreq);
	const rawRowIm = new Float32Array(blockTime * blockFreq);
	const nlmRowRe = new Float32Array(blockTime * blockFreq);
	const nlmRowIm = new Float32Array(blockTime * blockFreq);

	// Column-FFT transposed buffers [f * blockTime + t]
	const colInRe = new Float32Array(blockTime * blockFreq);
	const colInIm = new Float32Array(blockTime * blockFreq);

	// Full 2D-FFT output [f * blockTime + t]
	const rawColRe = new Float32Array(blockTime * blockFreq);
	const rawColIm = new Float32Array(blockTime * blockFreq);
	const nlmColRe = new Float32Array(blockTime * blockFreq);
	const nlmColIm = new Float32Array(blockTime * blockFreq);

	// Synthesis buffers after gain application [f * blockTime + t]
	const gainColRe = new Float32Array(blockTime * blockFreq);
	const gainColIm = new Float32Array(blockTime * blockFreq);

	// Per-column scratch (length = blockTime)
	const scratchRe = new Float32Array(blockTime);
	const scratchIm = new Float32Array(blockTime);
	const scratchOutRe = new Float32Array(blockTime);
	const scratchOutIm = new Float32Array(blockTime);

	// Per-row scratch (length = blockFreq)
	const rowScratch = new Float32Array(blockFreq);
	const rowScratchRe = new Float32Array(blockFreq);
	const rowScratchIm = new Float32Array(blockFreq);

	// Synthesis block output [t * blockFreq + f]
	const synthBlock = new Float32Array(blockTime * blockFreq);

	// Pre-allocated FFT workspaces, reused across all blocks/rows/columns to avoid
	// per-call Float32Array allocations inside the hot loop.
	const rowFwdWorkspace = createFftWorkspace(blockFreq);
	const colFwdWorkspaceA = createFftWorkspace(blockTime);
	const colFwdWorkspaceB = createFftWorkspace(blockTime);
	const colInvWorkspace = createFftWorkspace(blockTime);
	const rowInvWorkspace = createFftWorkspace(blockFreq);

	// Iterate over overlapping blocks
	for (let frameStart = 0; frameStart < numFrames; frameStart += hopTime) {
		for (let binStart = 0; binStart < numBins; binStart += hopFreq) {
			// --- Extract windowed blocks ---
			for (let tf = 0; tf < blockTime; tf++) {
				const srcFrame = frameStart + tf < numFrames ? frameStart + tf : numFrames - 1;

				for (let bf = 0; bf < blockFreq; bf++) {
					const srcBin = binStart + bf < numBins ? binStart + bf : numBins - 1;
					const winVal = win2d[tf * blockFreq + bf]!;
					const srcPos = srcFrame * numBins + srcBin;

					blockRaw[tf * blockFreq + bf] = rawMask[srcPos]! * winVal;
					blockNlm[tf * blockFreq + bf] = nlmSmoothed[srcPos]! * winVal;
				}
			}

			// --- 2D-FFT Step 1: FFT each row (real input → complex output) ---
			for (let tf = 0; tf < blockTime; tf++) {
				for (let bf = 0; bf < blockFreq; bf++) {
					rowScratch[bf] = blockRaw[tf * blockFreq + bf]!;
				}

				const { re: rowRe, im: rowIm } = fft(rowScratch, rowFwdWorkspace);

				for (let bf = 0; bf < blockFreq; bf++) {
					rawRowRe[tf * blockFreq + bf] = rowRe[bf]!;
					rawRowIm[tf * blockFreq + bf] = rowIm[bf]!;
				}
			}

			for (let tf = 0; tf < blockTime; tf++) {
				for (let bf = 0; bf < blockFreq; bf++) {
					rowScratch[bf] = blockNlm[tf * blockFreq + bf]!;
				}

				const { re: rowRe, im: rowIm } = fft(rowScratch, rowFwdWorkspace);

				for (let bf = 0; bf < blockFreq; bf++) {
					nlmRowRe[tf * blockFreq + bf] = rowRe[bf]!;
					nlmRowIm[tf * blockFreq + bf] = rowIm[bf]!;
				}
			}

			// --- 2D-FFT Step 2: complex FFT each column ---
			// Transpose row-FFT output to column-major for column access [f * blockTime + t]
			for (let tf = 0; tf < blockTime; tf++) {
				for (let bf = 0; bf < blockFreq; bf++) {
					colInRe[bf * blockTime + tf] = rawRowRe[tf * blockFreq + bf]!;
					colInIm[bf * blockTime + tf] = rawRowIm[tf * blockFreq + bf]!;
				}
			}

			for (let bf = 0; bf < blockFreq; bf++) {
				for (let tf = 0; tf < blockTime; tf++) {
					scratchRe[tf] = colInRe[bf * blockTime + tf]!;
					scratchIm[tf] = colInIm[bf * blockTime + tf]!;
				}

				complexFft(scratchRe, scratchIm, scratchOutRe, scratchOutIm, colFwdWorkspaceA, colFwdWorkspaceB);

				for (let tf = 0; tf < blockTime; tf++) {
					rawColRe[bf * blockTime + tf] = scratchOutRe[tf]!;
					rawColIm[bf * blockTime + tf] = scratchOutIm[tf]!;
				}
			}

			// Same for NLM block
			for (let tf = 0; tf < blockTime; tf++) {
				for (let bf = 0; bf < blockFreq; bf++) {
					colInRe[bf * blockTime + tf] = nlmRowRe[tf * blockFreq + bf]!;
					colInIm[bf * blockTime + tf] = nlmRowIm[tf * blockFreq + bf]!;
				}
			}

			for (let bf = 0; bf < blockFreq; bf++) {
				for (let tf = 0; tf < blockTime; tf++) {
					scratchRe[tf] = colInRe[bf * blockTime + tf]!;
					scratchIm[tf] = colInIm[bf * blockTime + tf]!;
				}

				complexFft(scratchRe, scratchIm, scratchOutRe, scratchOutIm, colFwdWorkspaceA, colFwdWorkspaceB);

				for (let tf = 0; tf < blockTime; tf++) {
					nlmColRe[bf * blockTime + tf] = scratchOutRe[tf]!;
					nlmColIm[bf * blockTime + tf] = scratchOutIm[tf]!;
				}
			}

			// --- Wiener suppression in 2D-frequency space (Lukin & Todd 2007 §4.2) ---
			// The NLM-smoothed block is the clean-signal estimate; the DFTT noise
			// spectrum is assumed white with scalar stddev σ = threshold:
			//   G[k] = |nlm_2dfft[k]|² / (|nlm_2dfft[k]|² + σ²)
			// Bins where nlm is strong (signal structure) get gain ≈ 1 (preserve raw);
			// bins where nlm is near zero (musical-noise components NLM smoothed away)
			// get gain ≈ 0 (attenuate raw). No broadband scaling of signal-dominant bins.
			const sigmaSq = threshold * threshold;

			for (let bf = 0; bf < blockFreq; bf++) {
				for (let tf = 0; tf < blockTime; tf++) {
					const flatIdx = bf * blockTime + tf;
					const nlmRe = nlmColRe[flatIdx]!;
					const nlmIm = nlmColIm[flatIdx]!;
					const nlmMagSq = nlmRe * nlmRe + nlmIm * nlmIm;
					const gain = nlmMagSq / (nlmMagSq + sigmaSq);

					gainColRe[flatIdx] = rawColRe[flatIdx]! * gain;
					gainColIm[flatIdx] = rawColIm[flatIdx]! * gain;
				}
			}

			// --- Inverse 2D-FFT Step 1: iFFT each column ---
			// ifft(re, im) treats (re, im) as a full complex spectrum, returns real time domain.
			for (let bf = 0; bf < blockFreq; bf++) {
				for (let tf = 0; tf < blockTime; tf++) {
					scratchRe[tf] = gainColRe[bf * blockTime + tf]!;
					scratchIm[tf] = gainColIm[bf * blockTime + tf]!;
				}

				const icolResult = ifft(scratchRe, scratchIm, colInvWorkspace);

				for (let tf = 0; tf < blockTime; tf++) {
					colInRe[bf * blockTime + tf] = icolResult[tf]!;
				}
			}

			// --- Inverse 2D-FFT Step 2: iFFT each row ---
			// Transpose back to row-major [t * blockFreq + f]; after column iFFT result is real.
			for (let tf = 0; tf < blockTime; tf++) {
				for (let bf = 0; bf < blockFreq; bf++) {
					rowScratchRe[bf] = colInRe[bf * blockTime + tf]!;
					rowScratchIm[bf] = 0;
				}

				const irowResult = ifft(rowScratchRe, rowScratchIm, rowInvWorkspace);

				for (let bf = 0; bf < blockFreq; bf++) {
					synthBlock[tf * blockFreq + bf] = irowResult[bf]!;
				}
			}

			// --- Overlap-add: apply synthesis window and accumulate ---
			for (let tf = 0; tf < blockTime; tf++) {
				const destFrame = frameStart + tf;

				if (destFrame >= numFrames) break;

				for (let bf = 0; bf < blockFreq; bf++) {
					const destBin = binStart + bf;

					if (destBin >= numBins) break;

					const winVal = win2d[tf * blockFreq + bf]!;
					const destPos = destFrame * numBins + destBin;

					accumulator[destPos] = accumulator[destPos]! + synthBlock[tf * blockFreq + bf]! * winVal;
					windowSumSq[destPos] = windowSumSq[destPos]! + winVal * winVal;
				}
			}
		}
	}

	// Normalise overlap-add output and clamp to [0,1]. DFTT input/output is a gain mask.
	for (let flatIdx = 0; flatIdx < numFrames * numBins; flatIdx++) {
		const ws = windowSumSq[flatIdx]!;

		if (ws > 1e-8) {
			const normalisedVal = accumulator[flatIdx]! / ws;

			output[flatIdx] = normalisedVal < 0 ? 0 : normalisedVal > 1 ? 1 : normalisedVal;
		} else {
			output[flatIdx] = rawMask[flatIdx]!;
		}
	}
}
