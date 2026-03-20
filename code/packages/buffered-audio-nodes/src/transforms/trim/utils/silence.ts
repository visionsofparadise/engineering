export function findFirstAbove(samples: Array<Float32Array>, frames: number, threshold: number): number {
	for (let index = 0; index < frames; index++) {
		for (const channel of samples) {
			if (Math.abs(channel[index] ?? 0) > threshold) {
				return index;
			}
		}
	}

	return frames;
}

export function findLastAbove(samples: Array<Float32Array>, frames: number, threshold: number): number {
	for (let index = frames - 1; index >= 0; index--) {
		for (const channel of samples) {
			if (Math.abs(channel[index] ?? 0) > threshold) {
				return index;
			}
		}
	}

	return 0;
}
