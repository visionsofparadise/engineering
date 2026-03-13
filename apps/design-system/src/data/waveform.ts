export function generateWaveformData(
	durationSeconds: number,
	pointsPerSecond: number,
): Float32Array {
	const totalPoints = Math.floor(durationSeconds * pointsPerSecond);
	const waveformData = new Float32Array(totalPoints * 2);

	const fundamentalFreq = 440;
	const sampleRate = pointsPerSecond;

	for (let point = 0; point < totalPoints; point++) {
		const time = point / sampleRate;
		const normalizedTime = point / totalPoints;

		const envelope = computeEnvelope(normalizedTime);

		let signal = 0;
		signal += Math.sin(2 * Math.PI * fundamentalFreq * time) * 0.4;
		signal += Math.sin(2 * Math.PI * fundamentalFreq * 2 * time) * 0.2;
		signal += Math.sin(2 * Math.PI * fundamentalFreq * 3 * time) * 0.1;
		signal += Math.sin(2 * Math.PI * fundamentalFreq * 5 * time) * 0.05;

		const lfoRate = 3.2;
		const lfoDepth = 0.15;
		const lfo = 1 - lfoDepth + lfoDepth * Math.sin(2 * Math.PI * lfoRate * time);

		signal *= envelope * lfo;

		const noiseFloor = (Math.random() - 0.5) * 0.02;
		signal += noiseFloor;

		const hasTransient = isTransientPosition(normalizedTime);
		if (hasTransient) {
			const transientEnvelope = computeTransientEnvelope(normalizedTime);
			signal += transientEnvelope * (Math.random() - 0.5) * 0.6;
		}

		const variation = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.7 * time);
		const minSample = Math.max(-1, signal * variation - Math.abs(noiseFloor) * 2);
		const maxSample = Math.min(1, signal * variation + Math.abs(noiseFloor) * 2);

		waveformData[point * 2] = Math.min(minSample, -Math.abs(signal * 0.3));
		waveformData[point * 2 + 1] = Math.max(maxSample, Math.abs(signal * 0.3));
	}

	return waveformData;
}

function computeEnvelope(normalizedTime: number): number {
	const attackEnd = 0.02;
	const sustainStart = 0.05;
	const sustainEnd = 0.85;
	const releaseEnd = 1.0;

	if (normalizedTime < attackEnd) {
		return normalizedTime / attackEnd;
	}
	if (normalizedTime < sustainStart) {
		const decayProgress = (normalizedTime - attackEnd) / (sustainStart - attackEnd);
		return 1.0 - decayProgress * 0.15;
	}
	if (normalizedTime < sustainEnd) {
		const sustainProgress = (normalizedTime - sustainStart) / (sustainEnd - sustainStart);
		return 0.85 - sustainProgress * 0.1 + 0.08 * Math.sin(sustainProgress * Math.PI * 6);
	}
	const releaseProgress = (normalizedTime - sustainEnd) / (releaseEnd - sustainEnd);
	return Math.max(0, 0.75 * (1 - releaseProgress * releaseProgress));
}

function isTransientPosition(normalizedTime: number): boolean {
	const transientPositions = [0.02, 0.15, 0.28, 0.42, 0.55, 0.68, 0.78];
	return transientPositions.some((position) => Math.abs(normalizedTime - position) < 0.008);
}

function computeTransientEnvelope(normalizedTime: number): number {
	const transientPositions = [0.02, 0.15, 0.28, 0.42, 0.55, 0.68, 0.78];
	for (const position of transientPositions) {
		const distance = Math.abs(normalizedTime - position);
		if (distance < 0.008) {
			return 1 - distance / 0.008;
		}
	}
	return 0;
}

export function generateStereoWaveformData(
	durationSeconds: number,
	pointsPerSecond: number,
): { left: Float32Array; right: Float32Array } {
	const left = generateWaveformData(durationSeconds, pointsPerSecond);

	const totalPoints = Math.floor(durationSeconds * pointsPerSecond);
	const right = new Float32Array(totalPoints * 2);
	for (let index = 0; index < left.length; index++) {
		const value = left[index] ?? 0;
		const variation = 0.92 + 0.08 * Math.sin(index * 0.013);
		right[index] = value * variation;
	}

	return { left, right };
}
