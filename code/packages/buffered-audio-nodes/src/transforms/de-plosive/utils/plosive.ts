export interface PlosiveDetection {
	readonly isPlosive: boolean;
	readonly lpState: number;
}

export function detectPlosive(
	channel: Float32Array,
	cutoffCoeff: number,
	threshold: number,
	initialLpState: number,
): PlosiveDetection {
	let lpVal = initialLpState;
	let lowEnergy = 0;
	let totalEnergy = 0;

	for (const sample of channel) {
		lpVal = lpVal * cutoffCoeff + sample * (1 - cutoffCoeff);
		lowEnergy += lpVal * lpVal;
		totalEnergy += sample * sample;
	}

	const lowRatio = totalEnergy > 0 ? lowEnergy / totalEnergy : 0;
	const isPlosive = lowRatio > 0.5 && Math.sqrt(lowEnergy / channel.length) > threshold;

	return { isPlosive, lpState: lpVal };
}

export function removePlosive(
	channel: Float32Array,
	cutoffCoeff: number,
	initialLpState: number,
	fadeLength: number,
): Float32Array {
	const output = new Float32Array(channel.length);
	let lpVal = initialLpState;

	for (let index = 0; index < channel.length; index++) {
		const sample = channel[index] ?? 0;

		lpVal = lpVal * cutoffCoeff + sample * (1 - cutoffCoeff);
		const filtered = sample - lpVal * 0.8;

		let fade = 1;

		if (index < fadeLength) {
			fade = index / fadeLength;
		} else if (index > channel.length - fadeLength) {
			fade = (channel.length - index) / fadeLength;
		}

		output[index] = sample * (1 - fade) + filtered * fade;
	}

	return output;
}
