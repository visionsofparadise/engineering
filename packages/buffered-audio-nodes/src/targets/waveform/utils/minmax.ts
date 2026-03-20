export function updateMinMax(
	samples: ReadonlyArray<Float32Array>,
	frame: number,
	channels: number,
	min: Float32Array,
	max: Float32Array,
): void {
	for (let ch = 0; ch < channels; ch++) {
		const sample = samples[ch]?.[frame] ?? 0;
		const currentMin = min[ch];
		const currentMax = max[ch];

		if (currentMin !== undefined && sample < currentMin) min[ch] = sample;
		if (currentMax !== undefined && sample > currentMax) max[ch] = sample;
	}
}

export function writeMinMaxPoint(
	min: Float32Array,
	max: Float32Array,
	channels: number,
	target: Buffer,
	offset: number,
): void {
	for (let ch = 0; ch < channels; ch++) {
		target.writeFloatLE(min[ch] ?? 0, offset + ch * 8);
		target.writeFloatLE(max[ch] ?? 0, offset + ch * 8 + 4);
	}
}
