import {
	biquadFilter,
	zeroPhaseBiquadFilter,
	lowPassCoefficients,
	highPassCoefficients,
	bandPassCoefficients,
	peakingCoefficients,
	lowShelfCoefficients,
	highShelfCoefficients,
	notchCoefficients,
	allPassCoefficients,
	preFilterCoefficients,
	rlbFilterCoefficients,
} from "./biquad";

describe("coefficient functions at 48kHz", () => {
	it("lowPassCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = lowPassCoefficients(48000, 1000);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("highPassCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = highPassCoefficients(48000, 1000);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("bandPassCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = bandPassCoefficients(48000, 1000, 1.0);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("peakingCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = peakingCoefficients(48000, 1000, 1.0, 6);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("peakingCoefficients with negative gain has finite coefficients", () => {
		const { fb, fa } = peakingCoefficients(48000, 1000, 1.0, -6);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("peakingCoefficients with 0dB gain passes signal unchanged (identity)", () => {
		const { fb, fa } = peakingCoefficients(48000, 1000, 1.0, 0);
		const signal = new Float32Array(512);
		for (let i = 0; i < 512; i++) signal[i] = Math.sin(2 * Math.PI * 100 * i / 48000);
		const output = biquadFilter(signal, fb, fa);
		for (let i = 0; i < 512; i++) {
			expect(output[i]).toBeCloseTo(signal[i]!, 5);
		}
	});

	it("lowShelfCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = lowShelfCoefficients(48000, 200, 0.707, 6);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("highShelfCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = highShelfCoefficients(48000, 8000, 0.707, 6);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("notchCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = notchCoefficients(48000, 1000, 1.0);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("allPassCoefficients has fa[0] = 1.0 and finite coefficients", () => {
		const { fb, fa } = allPassCoefficients(48000, 1000, 1.0);
		expect(fa[0]).toBe(1.0);
		for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
	});

	it("lowPassCoefficients produces different coefficients at quality=0.5 vs quality=2.0", () => {
		const low = lowPassCoefficients(48000, 1000, 0.5);
		const high = lowPassCoefficients(48000, 1000, 2.0);
		// At least one coefficient must differ between the two quality settings
		const allSame = low.fb.every((v, i) => v === high.fb[i]) && low.fa.every((v, i) => v === high.fa[i]);
		expect(allSame).toBe(false);
	});

	it("highPassCoefficients produces different coefficients at quality=0.5 vs quality=2.0", () => {
		const low = highPassCoefficients(48000, 1000, 0.5);
		const high = highPassCoefficients(48000, 1000, 2.0);
		const allSame = low.fb.every((v, i) => v === high.fb[i]) && low.fa.every((v, i) => v === high.fa[i]);
		expect(allSame).toBe(false);
	});
});

describe("EQ filter transfer behavior", () => {
	const sampleRate = 48000;
	const length = 8192;

	function makeSinusoid(freq: number): Float32Array {
		const sig = new Float32Array(length);
		for (let i = 0; i < length; i++) sig[i] = Math.sin(2 * Math.PI * freq * i / sampleRate);
		return sig;
	}

	function steadyStateRms(samples: Float32Array): number {
		const half = Math.floor(samples.length / 2);
		let sum = 0;
		for (let i = half; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
		return Math.sqrt(sum / (samples.length - half));
	}

	it("peakingCoefficients boosts level at center frequency", () => {
		const gainDb = 6;
		const { fb, fa } = peakingCoefficients(sampleRate, 1000, 1.0, gainDb);
		const signal = makeSinusoid(1000);
		const filtered = biquadFilter(signal, fb, fa);
		const rmsIn = steadyStateRms(signal);
		const rmsOut = steadyStateRms(filtered);
		// Expect output to be louder (at least 2dB boost at center)
		expect(rmsOut).toBeGreaterThan(rmsIn * 1.26);
	});

	it("peakingCoefficients cuts level at center frequency when gain is negative", () => {
		const gainDb = -6;
		const { fb, fa } = peakingCoefficients(sampleRate, 1000, 1.0, gainDb);
		const signal = makeSinusoid(1000);
		const filtered = biquadFilter(signal, fb, fa);
		const rmsIn = steadyStateRms(signal);
		const rmsOut = steadyStateRms(filtered);
		expect(rmsOut).toBeLessThan(rmsIn * 0.8);
	});

	it("lowShelfCoefficients boosts low frequency and passes high frequency", () => {
		const { fb: fbL, fa: faL } = lowShelfCoefficients(sampleRate, 200, 0.707, 6);
		const lowSig = makeSinusoid(50);
		const highSig = makeSinusoid(8000);
		const lowOut = biquadFilter(lowSig, fbL, faL);
		const highOut = biquadFilter(highSig, fbL, faL);
		expect(steadyStateRms(lowOut)).toBeGreaterThan(steadyStateRms(lowSig) * 1.26);
		expect(steadyStateRms(highOut)).toBeCloseTo(steadyStateRms(highSig), 1);
	});

	it("highShelfCoefficients boosts high frequency and passes low frequency", () => {
		const { fb, fa } = highShelfCoefficients(sampleRate, 8000, 0.707, 6);
		const lowSig = makeSinusoid(100);
		const highSig = makeSinusoid(16000);
		const lowOut = biquadFilter(lowSig, fb, fa);
		const highOut = biquadFilter(highSig, fb, fa);
		expect(steadyStateRms(highOut)).toBeGreaterThan(steadyStateRms(highSig) * 1.26);
		expect(steadyStateRms(lowOut)).toBeCloseTo(steadyStateRms(lowSig), 1);
	});

	it("notchCoefficients strongly attenuates signal at notch frequency", () => {
		const notchFreq = 1000;
		const { fb, fa } = notchCoefficients(sampleRate, notchFreq, 2.0);
		const signal = makeSinusoid(notchFreq);
		const filtered = biquadFilter(signal, fb, fa);
		const rmsIn = steadyStateRms(signal);
		const rmsOut = steadyStateRms(filtered);
		expect(rmsOut).toBeLessThan(rmsIn * 0.1);
	});

	it("allPassCoefficients preserves amplitude across frequency", () => {
		const { fb, fa } = allPassCoefficients(sampleRate, 1000, 1.0);
		for (const freq of [100, 1000, 8000]) {
			const signal = makeSinusoid(freq);
			const filtered = biquadFilter(signal, fb, fa);
			const rmsIn = steadyStateRms(signal);
			const rmsOut = steadyStateRms(filtered);
			expect(rmsOut).toBeCloseTo(rmsIn, 2);
		}
	});
});

describe("preFilterCoefficients", () => {
	it("returns hardcoded BS.1770-4 constants at 48kHz", () => {
		const { fb, fa } = preFilterCoefficients(48000);
		expect(fb).toEqual([1.53512485958697, -2.69169618940638, 1.19839281085285]);
		expect(fa).toEqual([1.0, -1.69065929318241, 0.73248077421585]);
	});

	it("returns finite coefficients with fa[0] = 1.0 at non-48kHz rates", () => {
		for (const rate of [44100, 96000, 22050]) {
			const { fb, fa } = preFilterCoefficients(rate);
			expect(fa[0]).toBe(1.0);
			for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
		}
	});
});

describe("rlbFilterCoefficients", () => {
	it("returns hardcoded constants at 48kHz", () => {
		const { fb, fa } = rlbFilterCoefficients(48000);
		expect(fb).toEqual([1.0, -2.0, 1.0]);
		expect(fa).toEqual([1.0, -1.99004745483398, 0.99007225036621]);
	});

	it("returns finite coefficients with fa[0] = 1.0 at non-48kHz rates", () => {
		for (const rate of [44100, 96000, 22050]) {
			const { fb, fa } = rlbFilterCoefficients(rate);
			expect(fa[0]).toBe(1.0);
			for (const c of [...fb, ...fa]) expect(Number.isFinite(c)).toBe(true);
		}
	});
});

describe("biquadFilter", () => {
	it("passes DC and attenuates high frequency through a low-pass filter", () => {
		const sampleRate = 48000;
		const { fb, fa } = lowPassCoefficients(sampleRate, 200);
		const length = 4096;
		const signal = new Float32Array(length);

		for (let i = 0; i < length; i++) {
			signal[i] = 1.0 + Math.sin(2 * Math.PI * 10000 * i / sampleRate);
		}

		const output = biquadFilter(signal, fb, fa);

		const dcMean = output.slice(length / 2).reduce((s, v) => s + v, 0) / (length / 2);
		expect(dcMean).toBeCloseTo(1.0, 0);

		let hfEnergy = 0;
		for (let i = length / 2; i < length; i++) {
			const deviation = output[i]! - dcMean;
			hfEnergy += deviation * deviation;
		}
		const hfRms = Math.sqrt(hfEnergy / (length / 2));
		expect(hfRms).toBeLessThan(0.1);
	});

	it("returns a new array and does not mutate input", () => {
		const signal = new Float32Array([1, 2, 3, 4, 5]);
		const copy = Float32Array.from(signal);
		const { fb, fa } = lowPassCoefficients(48000, 1000);

		const output = biquadFilter(signal, fb, fa);

		expect(output).not.toBe(signal);
		expect(Array.from(signal)).toEqual(Array.from(copy));
	});
});

describe("zeroPhaseBiquadFilter", () => {
	it("mutates the input array in-place", () => {
		const signal = new Float32Array([0, 0, 0, 1, 0, 0, 0]);
		const original = signal;
		const coefficients = lowPassCoefficients(48000, 1000);

		zeroPhaseBiquadFilter(signal, coefficients);

		expect(signal).toBe(original);
		expect(signal[3]).not.toBe(1);
	});

	it("produces a symmetric response to an impulse (zero-phase property)", () => {
		const length = 256;
		const signal = new Float32Array(length);
		signal[length / 2] = 1.0;
		const coefficients = lowPassCoefficients(48000, 2000);

		zeroPhaseBiquadFilter(signal, coefficients);

		const center = length / 2;
		const checkRange = center / 2;
		for (let offset = 1; offset < checkRange; offset++) {
			expect(signal[center + offset]).toBeCloseTo(signal[center - offset]!, 4);
		}
	});
});
