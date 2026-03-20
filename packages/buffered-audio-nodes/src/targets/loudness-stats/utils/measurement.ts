import { biquadFilter, preFilterCoefficients, rlbFilterCoefficients } from "../../../utils/biquad";

export function flattenBuffers(chunks: Array<Float32Array>, totalFrames: number): Float32Array {
	const result = new Float32Array(totalFrames);
	let offset = 0;

	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}

	return result;
}

export function applyKWeighting(channelBuffers: Array<Array<Float32Array>>, channels: number, frames: number, sampleRate: number): Array<Float32Array> {
	const result: Array<Float32Array> = [];

	for (let ch = 0; ch < channels; ch++) {
		const buffers = channelBuffers[ch];

		if (!buffers) continue;
		const channelData = flattenBuffers(buffers, frames);
		const filtered = applyPreFilter(channelData, sampleRate);
		const rlbFiltered = applyRlbFilter(filtered, sampleRate);

		result.push(rlbFiltered);
	}

	return result;
}

export function applyPreFilter(samples: Float32Array, sampleRate: number): Float32Array {
	const { fb, fa } = preFilterCoefficients(sampleRate);

	return biquadFilter(samples, fb, fa);
}

export function applyRlbFilter(samples: Float32Array, sampleRate: number): Float32Array {
	const { fb, fa } = rlbFilterCoefficients(sampleRate);

	return biquadFilter(samples, fb, fa);
}

export function computeBlockLoudness(kWeighted: Array<Float32Array>, channels: number, frames: number, blockSize: number, stepSize: number): Array<number> {
	const results: Array<number> = [];

	for (let start = 0; start + blockSize <= frames; start += stepSize) {
		let sumMeanSquare = 0;

		for (let ch = 0; ch < channels; ch++) {
			const channel = kWeighted[ch];

			if (!channel) continue;

			let sum = 0;

			for (let index = start; index < start + blockSize; index++) {
				const sample = channel[index] ?? 0;

				sum += sample * sample;
			}

			sumMeanSquare += sum / blockSize;
		}

		const loudness = -0.691 + 10 * Math.log10(Math.max(sumMeanSquare, 1e-10));

		results.push(loudness);
	}

	return results;
}

export function computeIntegratedLoudness(kWeighted: Array<Float32Array>, channels: number, frames: number, blockSize: number, stepSize: number): number {
	const blockLoudness = computeBlockLoudness(kWeighted, channels, frames, blockSize, stepSize);

	if (blockLoudness.length === 0) return -Infinity;

	const absoluteGated = blockLoudness.filter((value) => value > -70);

	if (absoluteGated.length === 0) return -Infinity;

	const absoluteMean = absoluteGated.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / absoluteGated.length;
	const relativeThreshold = 10 * Math.log10(absoluteMean) - 10;

	const relativeGated = absoluteGated.filter((value) => value > relativeThreshold);

	if (relativeGated.length === 0) return -Infinity;

	const relativeMean = relativeGated.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / relativeGated.length;

	return 10 * Math.log10(relativeMean);
}

export function computeLra(shortTermLoudness: Array<number>): number {
	const absoluteGated = shortTermLoudness.filter((value) => value > -70);

	if (absoluteGated.length < 2) return 0;

	const absoluteMean = absoluteGated.reduce((sum, value) => sum + Math.pow(10, value / 10), 0) / absoluteGated.length;
	const relativeThreshold = 10 * Math.log10(absoluteMean) - 20;

	const relativeGated = absoluteGated.filter((value) => value > relativeThreshold);

	if (relativeGated.length < 2) return 0;

	relativeGated.sort((lhs, rhs) => lhs - rhs);

	const p10Index = Math.floor(relativeGated.length * 0.1);
	const p95Index = Math.min(Math.ceil(relativeGated.length * 0.95) - 1, relativeGated.length - 1);

	return (relativeGated[p95Index] ?? 0) - (relativeGated[p10Index] ?? 0);
}
