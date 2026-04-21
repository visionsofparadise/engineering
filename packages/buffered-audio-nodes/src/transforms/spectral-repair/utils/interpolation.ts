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
export function interpolateTfRegion(real: Float32Array, imag: Float32Array, startFrame: number, endFrame: number, startBin: number, endBin: number, frames: number, halfSize: number): void {
	const iterations = 5;
	const clampedStart = Math.max(0, startFrame);
	const clampedEnd = Math.min(frames, endFrame);

	if (clampedStart >= clampedEnd) return;

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
			const frameOffset = frame * halfSize;

			for (let bin = clampedStartBin; bin < clampedEndBin; bin++) {
				let realSum = 0;
				let imagSum = 0;
				let count = 0;

				if (frame > 0) {
					realSum += real[(frame - 1) * halfSize + bin] ?? 0;
					imagSum += imag[(frame - 1) * halfSize + bin] ?? 0;
					count++;
				}

				if (frame < frames - 1) {
					realSum += real[(frame + 1) * halfSize + bin] ?? 0;
					imagSum += imag[(frame + 1) * halfSize + bin] ?? 0;
					count++;
				}

				if (bin > 0) {
					realSum += real[frameOffset + bin - 1] ?? 0;
					imagSum += imag[frameOffset + bin - 1] ?? 0;
					count++;
				}

				if (bin < halfSize - 1) {
					realSum += real[frameOffset + bin + 1] ?? 0;
					imagSum += imag[frameOffset + bin + 1] ?? 0;
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
			const frameOffset = frame * halfSize;

			for (let bin = clampedStartBin; bin < clampedEndBin; bin++) {
				const bufferIndex = (frame - clampedStart) * regionBins + (bin - clampedStartBin);

				real[frameOffset + bin] = writeReal[bufferIndex] ?? 0;
				imag[frameOffset + bin] = writeImag[bufferIndex] ?? 0;
			}
		}
	}
}
