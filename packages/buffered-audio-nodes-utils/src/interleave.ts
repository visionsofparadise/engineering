export function interleave(samples: Array<Float32Array>, frames: number, channels: number): Float32Array {
	const interleaved = new Float32Array(frames * channels);

	for (let frame = 0; frame < frames; frame++) {
		for (let ch = 0; ch < channels; ch++) {
			interleaved[frame * channels + ch] = samples[ch]?.[frame] ?? 0;
		}
	}

	return interleaved;
}

export function deinterleaveBuffer(buffer: Buffer, channels: number): Array<Float32Array> {
	const totalSamples = buffer.length / 4;
	const frames = Math.floor(totalSamples / channels);
	const result: Array<Float32Array> = [];

	for (let ch = 0; ch < channels; ch++) {
		result.push(new Float32Array(frames));
	}

	const view = new Float32Array(buffer.buffer, buffer.byteOffset, totalSamples);

	for (let frame = 0; frame < frames; frame++) {
		for (let ch = 0; ch < channels; ch++) {
			const channelArray = result[ch];
			const value = view[frame * channels + ch];

			if (channelArray && value !== undefined) {
				channelArray[frame] = value;
			}
		}
	}

	return result;
}
