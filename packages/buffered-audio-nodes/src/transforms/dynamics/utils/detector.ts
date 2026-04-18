/**
 * Signal level detection for dynamics processing.
 *
 * Two detection modes:
 * - "peak": returns the maximum absolute sample value across all channels.
 * - "rms": returns the RMS level across all channels.
 *
 * Stereo linking is applied after per-channel computation and before
 * gain computations.
 */

export type DetectionMode = "peak" | "rms";
export type StereoLinkMode = "average" | "max" | "none";

/**
 * Compute the level for a single channel.
 * Returns a linear amplitude value (not dB).
 */
export function detectLevel(channel: Float32Array, mode: DetectionMode): number {
	if (channel.length === 0) return 0;

	if (mode === "peak") {
		let peak = 0;

		for (const sample of channel) {
			const abs = Math.abs(sample);

			if (abs > peak) peak = abs;
		}

		return peak;
	}

	// RMS
	let sum = 0;

	for (const sample of channel) {
		sum += sample * sample;
	}

	return Math.sqrt(sum / channel.length);
}

/**
 * Compute per-channel levels and apply stereo linking, returning one
 * gain-reduction level per channel.
 *
 * - "average": all channels use the mean level
 * - "max": all channels use the maximum level
 * - "none": each channel uses its own level independently
 */
export function detectLevels(
	samples: ReadonlyArray<Float32Array>,
	mode: DetectionMode,
	link: StereoLinkMode,
): Float32Array {
	const channelCount = samples.length;

	if (channelCount === 0) return new Float32Array(0);

	const perChannel = new Float32Array(channelCount);

	for (let ch = 0; ch < channelCount; ch++) {
		perChannel[ch] = detectLevel(samples[ch] ?? new Float32Array(0), mode);
	}

	if (link === "none") return perChannel;

	// Compute linked value
	let linked: number;

	if (link === "average") {
		let total = 0;

		for (const level of perChannel) total += level;
		linked = total / channelCount;
	} else {
		// "max"
		linked = 0;

		for (const level of perChannel) {
			if (level > linked) linked = level;
		}
	}

	const result = new Float32Array(channelCount);

	result.fill(linked);

	return result;
}
