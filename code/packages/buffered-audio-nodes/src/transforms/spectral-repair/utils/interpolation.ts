export interface SpectralRegion {
	readonly startTime: number;
	readonly endTime: number;
	readonly startFreq: number;
	readonly endFreq: number;
}

/**
 * Jacobi-style iteration: reads from source arrays, writes to separate buffers,
 * then swaps. This avoids the directional bias of in-place (Gauss-Seidel) updates.
 */
export function interpolateTfRegion(real: Array<Float32Array>, imag: Array<Float32Array>, startFrame: number, endFrame: number, startBin: number, endBin: number): void {
	const iterations = 5;
	const clampedStart = Math.max(0, startFrame);
	const clampedEnd = Math.min(real.length, endFrame);

	if (clampedStart >= clampedEnd) return;

	const halfSize = real[0]?.length ?? 0;
	const clampedStartBin = Math.max(0, startBin);
	const clampedEndBin = Math.min(halfSize, endBin);

	// Allocate write buffers for the region
	const regionFrames = clampedEnd - clampedStart;
	const regionBins = clampedEndBin - clampedStartBin;
	const writeReal = new Float32Array(regionFrames * regionBins);
	const writeImag = new Float32Array(regionFrames * regionBins);

	for (let iter = 0; iter < iterations; iter++) {
		// Read from current state, write to buffers
		for (let frame = clampedStart; frame < clampedEnd; frame++) {
			const realFrame = real[frame];
			const imagFrame = imag[frame];

			if (!realFrame || !imagFrame) continue;

			for (let bin = clampedStartBin; bin < clampedEndBin; bin++) {
				let realSum = 0;
				let imagSum = 0;
				let count = 0;

				const prevFrame = real[frame - 1];
				const nextFrame = real[frame + 1];
				const prevImag = imag[frame - 1];
				const nextImag = imag[frame + 1];

				if (prevFrame && prevImag) {
					realSum += prevFrame[bin] ?? 0;
					imagSum += prevImag[bin] ?? 0;
					count++;
				}

				if (nextFrame && nextImag) {
					realSum += nextFrame[bin] ?? 0;
					imagSum += nextImag[bin] ?? 0;
					count++;
				}

				if (bin > 0) {
					realSum += realFrame[bin - 1] ?? 0;
					imagSum += imagFrame[bin - 1] ?? 0;
					count++;
				}

				if (bin < halfSize - 1) {
					realSum += realFrame[bin + 1] ?? 0;
					imagSum += imagFrame[bin + 1] ?? 0;
					count++;
				}

				if (count > 0) {
					const bufferIndex = (frame - clampedStart) * regionBins + (bin - clampedStartBin);

					writeReal[bufferIndex] = realSum / count;
					writeImag[bufferIndex] = imagSum / count;
				}
			}
		}

		// Copy write buffers back to source arrays
		for (let frame = clampedStart; frame < clampedEnd; frame++) {
			const realFrame = real[frame];
			const imagFrame = imag[frame];

			if (!realFrame || !imagFrame) continue;

			for (let bin = clampedStartBin; bin < clampedEndBin; bin++) {
				const bufferIndex = (frame - clampedStart) * regionBins + (bin - clampedStartBin);

				realFrame[bin] = writeReal[bufferIndex] ?? 0;
				imagFrame[bin] = writeImag[bufferIndex] ?? 0;
			}
		}
	}
}
