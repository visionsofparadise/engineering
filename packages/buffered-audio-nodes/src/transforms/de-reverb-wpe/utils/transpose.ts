/* eslint-disable @typescript-eslint/no-non-null-assertion -- tight DSP loops with bounds-checked typed array access */

export function transposeToBinMajor(
	stftReal: ReadonlyArray<Float32Array>,
	stftImag: ReadonlyArray<Float32Array>,
	numFrames: number,
	numBins: number,
	realT: Float32Array,
	imagT: Float32Array,
): void {
	for (let frame = 0; frame < numFrames; frame++) {
		const re = stftReal[frame];
		const im = stftImag[frame];

		if (!re || !im) continue;

		for (let bin = 0; bin < numBins; bin++) {
			realT[bin * numFrames + frame] = re[bin]!;
			imagT[bin * numFrames + frame] = im[bin]!;
		}
	}
}

export function transposeToFrameMajor(
	realT: Float32Array,
	imagT: Float32Array,
	stftReal: Array<Float32Array>,
	stftImag: Array<Float32Array>,
	numFrames: number,
	numBins: number,
): void {
	for (let frame = 0; frame < numFrames; frame++) {
		const re = stftReal[frame];
		const im = stftImag[frame];

		if (!re || !im) continue;

		for (let bin = 0; bin < numBins; bin++) {
			re[bin] = realT[bin * numFrames + frame]!;
			im[bin] = imagT[bin * numFrames + frame]!;
		}
	}
}
