export function linearResample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
	if (fromRate === toRate) return input;

	const ratio = toRate / fromRate;
	const outputLength = Math.round(input.length * ratio);
	const output = new Float32Array(outputLength);

	for (let index = 0; index < outputLength; index++) {
		const srcPos = index / ratio;
		const srcIndex = Math.floor(srcPos);
		const fraction = srcPos - srcIndex;

		const sample0 = input[srcIndex] ?? 0;
		const sample1 = input[srcIndex + 1] ?? sample0;

		output[index] = sample0 + fraction * (sample1 - sample0);
	}

	return output;
}
