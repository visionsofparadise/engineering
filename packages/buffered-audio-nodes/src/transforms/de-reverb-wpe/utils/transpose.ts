/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */

export function transposeToBinMajor(
	stftReal: Float32Array,
	stftImag: Float32Array,
	numFrames: number,
	numBins: number,
	realT: Float32Array,
	imagT: Float32Array,
): void {
	for (let frame = 0; frame < numFrames; frame++) {
		const frameOffset = frame * numBins;

		for (let bin = 0; bin < numBins; bin++) {
			realT[bin * numFrames + frame] = stftReal[frameOffset + bin]!;
			imagT[bin * numFrames + frame] = stftImag[frameOffset + bin]!;
		}
	}
}

export function transposeToFrameMajor(
	realT: Float32Array,
	imagT: Float32Array,
	stftReal: Float32Array,
	stftImag: Float32Array,
	numFrames: number,
	numBins: number,
): void {
	for (let frame = 0; frame < numFrames; frame++) {
		const frameOffset = frame * numBins;

		for (let bin = 0; bin < numBins; bin++) {
			stftReal[frameOffset + bin] = realT[bin * numFrames + frame]!;
			stftImag[frameOffset + bin] = imagT[bin * numFrames + frame]!;
		}
	}
}
