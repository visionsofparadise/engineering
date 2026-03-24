export function generateSpectrogramData(
	numFrames: number,
	numBins: number,
): Float32Array {
	const spectrogramData = new Float32Array(numFrames * numBins);

	const fundamentalBin = Math.floor(numBins * 0.022);
	const harmonics = [1, 2, 3, 4, 5, 6, 8, 10];
	const harmonicAmplitudes = [1.0, 0.6, 0.35, 0.2, 0.12, 0.08, 0.04, 0.02];

	const formantCenters = [
		Math.floor(numBins * 0.04),
		Math.floor(numBins * 0.12),
		Math.floor(numBins * 0.22),
	];
	const formantWidths = [
		Math.floor(numBins * 0.015),
		Math.floor(numBins * 0.025),
		Math.floor(numBins * 0.035),
	];

	for (let frame = 0; frame < numFrames; frame++) {
		const normalizedTime = frame / numFrames;
		const envelope = computeSpectrogramEnvelope(normalizedTime);

		for (let bin = 0; bin < numBins; bin++) {
			let magnitude = 0;

			const noiseFloor = 0.0001 * Math.pow(1 - bin / numBins, 1.5);

			magnitude += noiseFloor * (0.5 + Math.random() * 0.5);

			for (let harmonicIndex = 0; harmonicIndex < harmonics.length; harmonicIndex++) {
				const harmonicNumber = harmonics[harmonicIndex];
				const amplitude = harmonicAmplitudes[harmonicIndex];

				if (harmonicNumber === undefined || amplitude === undefined) continue;

				const harmonicBin = fundamentalBin * harmonicNumber;
				const distance = Math.abs(bin - harmonicBin);
				const spread = 2 + harmonicIndex * 0.5;

				if (distance < spread * 3) {
					const gaussianFactor = Math.exp(-(distance * distance) / (2 * spread * spread));
					const timeModulation = 1 + 0.1 * Math.sin(normalizedTime * Math.PI * (3 + harmonicIndex));

					magnitude += amplitude * gaussianFactor * envelope * timeModulation;
				}
			}

			for (let formantIndex = 0; formantIndex < formantCenters.length; formantIndex++) {
				const center = formantCenters[formantIndex];
				const width = formantWidths[formantIndex];

				if (center === undefined || width === undefined) continue;

				const distance = Math.abs(bin - center);

				if (distance < width * 3) {
					const factor = Math.exp(-(distance * distance) / (2 * width * width));
					const formantAmplitude = 0.15 * (1 - formantIndex * 0.3);
					const timeVariation = 0.8 + 0.2 * Math.sin(normalizedTime * Math.PI * (2 + formantIndex * 1.5));

					magnitude += formantAmplitude * factor * envelope * timeVariation;
				}
			}

			const hasTransient = isSpectrogramTransient(normalizedTime);

			if (hasTransient) {
				const transientAmount = computeTransientMagnitude(normalizedTime);
				const highFreqBoost = Math.pow(bin / numBins, 0.3);

				magnitude += transientAmount * highFreqBoost * 0.3 * (0.5 + Math.random() * 0.5);
			}

			spectrogramData[frame * numBins + bin] = Math.max(0, magnitude);
		}
	}

	return spectrogramData;
}

function computeSpectrogramEnvelope(normalizedTime: number): number {
	if (normalizedTime < 0.03) return normalizedTime / 0.03;
	if (normalizedTime < 0.85) return 0.85 + 0.15 * Math.sin(normalizedTime * Math.PI * 4);
	const release = (normalizedTime - 0.85) / 0.15;

	return Math.max(0, (1 - release) * (1 - release));
}

function isSpectrogramTransient(normalizedTime: number): boolean {
	const positions = [0.02, 0.15, 0.28, 0.42, 0.55, 0.68, 0.78];

	return positions.some((position) => Math.abs(normalizedTime - position) < 0.005);
}

function computeTransientMagnitude(normalizedTime: number): number {
	const positions = [0.02, 0.15, 0.28, 0.42, 0.55, 0.68, 0.78];

	for (const position of positions) {
		const distance = Math.abs(normalizedTime - position);

		if (distance < 0.005) return 1 - distance / 0.005;
	}

	return 0;
}

export function generateStereoSpectrogramData(
	numFrames: number,
	numBins: number,
): { left: Float32Array; right: Float32Array } {
	const left = generateSpectrogramData(numFrames, numBins);
	const right = new Float32Array(left.length);

	for (let index = 0; index < left.length; index++) {
		const value = left[index] ?? 0;
		const variation = 0.9 + 0.1 * Math.sin(index * 0.0037);

		right[index] = value * variation;
	}

	return { left, right };
}
