const GATE_THRESHOLD_DB = -60;

export function computeRms(samples: ReadonlyArray<Float32Array>): number {
	let sum = 0;
	let count = 0;

	for (const channel of samples) {
		for (const sample of channel) {
			sum += sample * sample;
			count++;
		}
	}

	return count > 0 ? Math.sqrt(sum / count) : 0;
}

export function computeTargetGain(
	rms: number,
	targetLoudness: number,
	maxGain: number,
	minGain: number,
): number | undefined {
	const rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));

	if (rmsDb <= GATE_THRESHOLD_DB) return undefined;

	const targetGainDb = targetLoudness - rmsDb;

	return Math.max(-minGain, Math.min(maxGain, targetGainDb));
}
