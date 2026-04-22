import { describe, it, expect } from "vitest";
import { decimate, integerDecimationRate } from "./decimator";

function makeSine(freqHz: number, frames: number, sampleRate: number): Float32Array {
	const out = new Float32Array(frames);

	for (let index = 0; index < frames; index++) {
		out[index] = Math.sin((2 * Math.PI * freqHz * index) / sampleRate);
	}

	return out;
}

function rms(signal: Float32Array): number {
	let sum = 0;

	for (const sample of signal) {
		sum += sample * sample;
	}

	return Math.sqrt(sum / signal.length);
}

// Goertzel-style single-frequency power estimate: returns the squared magnitude
// at the target frequency bin. Lets us measure energy at a specific frequency
// without pulling in a full FFT.
function goertzelPower(signal: Float32Array, targetHz: number, sampleRate: number): number {
	const omega = (2 * Math.PI * targetHz) / sampleRate;
	const coeff = 2 * Math.cos(omega);
	let s1 = 0;
	let s2 = 0;

	for (let index = 0; index < signal.length; index++) {
		const s0 = (signal[index] ?? 0) + coeff * s1 - s2;

		s2 = s1;
		s1 = s0;
	}

	// Squared magnitude of the DFT bin at targetHz.
	return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

describe("decimate", () => {
	it("rate=1 returns an equal-length fresh copy (not same reference)", () => {
		const input = makeSine(1000, 1024, 48000);
		const output = decimate(input, 1);

		expect(output).not.toBe(input);
		expect(output.length).toBe(input.length);

		for (let index = 0; index < input.length; index++) {
			expect(output[index]).toBe(input[index]);
		}
	});

	it("output length is floor(input.length / rate)", () => {
		const input = new Float32Array(48123);
		const output = decimate(input, 15);

		expect(output.length).toBe(Math.floor(48123 / 15));
	});

	it("preserves a 1 kHz passband sinewave through 48 kHz → 3.2 kHz decimation", () => {
		// 1 kHz sits safely below the new Nyquist of 1600 Hz; anti-alias LP at
		// 0.9 × 1600 = 1440 Hz should leave it largely intact.
		const sampleRate = 48000;
		const downsampledRate = 3200;
		const input = makeSine(1000, sampleRate, sampleRate); // 1 s
		const output = decimate(input, 15);

		expect(output.length).toBe(Math.floor(input.length / 15));

		// Sample a handful of frequencies around the target and confirm the
		// dominant energy is within a ±50 Hz window of 1 kHz. Using ±200 Hz
		// as the "total" band gives a conservative >90% energy fraction target.
		const innerBandHz = [950, 975, 1000, 1025, 1050];
		const totalBandHz = [850, 900, 950, 975, 1000, 1025, 1050, 1100, 1150];
		let innerPower = 0;
		let totalPower = 0;

		for (const freq of innerBandHz) {
			innerPower += goertzelPower(output, freq, downsampledRate);
		}
		for (const freq of totalBandHz) {
			totalPower += goertzelPower(output, freq, downsampledRate);
		}

		const fraction = innerPower / totalPower;

		expect(fraction).toBeGreaterThan(0.9);
	});

	it("rejects 6 kHz out-of-band content by ≥20 dB through 48 kHz → 3.2 kHz decimation", () => {
		// 6 kHz is well above the new Nyquist of 1600 Hz and the anti-alias
		// cutoff of 1440 Hz — the biquad cascade should attenuate it substantially.
		const sampleRate = 48000;
		const input = makeSine(6000, sampleRate, sampleRate); // 1 s
		const output = decimate(input, 15);

		const inputRms = rms(input);
		const outputRms = rms(output);
		// Skip the initial transient of the biquad cascade by measuring over the
		// middle portion of the output.
		const midStart = Math.floor(output.length / 4);
		const midLen = Math.floor(output.length / 2);
		const midOutput = output.slice(midStart, midStart + midLen);
		const midRms = rms(midOutput);
		const attenuationDb = 20 * Math.log10(inputRms / Math.max(midRms, 1e-12));

		expect(attenuationDb).toBeGreaterThan(20);
		// Sanity: the output RMS itself is also much lower than the input RMS.
		expect(outputRms).toBeLessThan(inputRms * 0.1);
	});

	it("throws on non-integer or sub-1 rate", () => {
		const input = new Float32Array(100);

		expect(() => decimate(input, 0)).toThrow();
		expect(() => decimate(input, 1.5)).toThrow();
		expect(() => decimate(input, -1)).toThrow();
	});
});

describe("integerDecimationRate", () => {
	it("returns the known-rate pins and clamped round(sr/3200) elsewhere", () => {
		expect(integerDecimationRate(48000)).toBe(15);
		expect(integerDecimationRate(44100)).toBe(14);
		expect(integerDecimationRate(96000)).toBe(30);
		expect(integerDecimationRate(16000)).toBe(5);
	});
});
