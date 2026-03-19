import { highPassCoefficients, lowPassCoefficients, zeroPhaseBiquadFilter } from "./biquad";

export function applyBandpass(channels: Array<Float32Array>, sampleRate: number, highPass?: number, lowPass?: number): void {
	if (!highPass && !lowPass) return;

	for (const channel of channels) {
		if (highPass) {
			zeroPhaseBiquadFilter(channel, highPassCoefficients(sampleRate, highPass));
		}

		if (lowPass) {
			zeroPhaseBiquadFilter(channel, lowPassCoefficients(sampleRate, lowPass));
		}
	}
}
