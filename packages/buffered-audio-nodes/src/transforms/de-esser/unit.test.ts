import { describe, it, expect } from "vitest";
import { deEsser, DeEsserNode } from ".";

const SAMPLE_RATE = 48000;

type TestChunk = { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number };

function makeSineChunk(frequencyHz: number, amplitude: number, frames = 4096, channels = 1): TestChunk {
	const samples: Array<Float32Array> = [];

	for (let ch = 0; ch < channels; ch++) {
		const data = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			data[index] = amplitude * Math.sin((2 * Math.PI * frequencyHz * index) / SAMPLE_RATE);
		}

		samples.push(data);
	}

	return { samples, offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
}

function runStream(node: ReturnType<typeof deEsser>, chunks: Array<TestChunk>): Array<TestChunk> {
	const stream = node.createStream();

	return chunks.map((chunk) => stream._unbuffer(chunk));
}

/** Peak |sample| across every channel and frame in a chunk. */
function peakOf(chunk: TestChunk): number {
	let peak = 0;

	for (const ch of chunk.samples) {
		for (const sample of ch) {
			const abs = sample >= 0 ? sample : -sample;

			if (abs > peak) peak = abs;
		}
	}

	return peak;
}

describe("DeEsserNode", () => {
	it("has correct static metadata", () => {
		expect(DeEsserNode.moduleName).toBe("DeEsser");
	});

	it("schema defaults match the de-esser spec", () => {
		const node = deEsser();

		expect(node.properties.frequency).toBe(6000);
		expect(node.properties.threshold).toBe(-20);
		expect(node.properties.ratio).toBe(4);
		expect(node.properties.range).toBe(-12);
		expect(node.properties.attack).toBe(5);
		expect(node.properties.release).toBe(80);
		expect(node.properties.mode).toBe("split");
	});

	it("accepts custom parameters via factory", () => {
		const node = deEsser({ frequency: 7500, threshold: -24, ratio: 8, mode: "wideband" });

		expect(node.properties.frequency).toBe(7500);
		expect(node.properties.threshold).toBe(-24);
		expect(node.properties.ratio).toBe(8);
		expect(node.properties.mode).toBe("wideband");
	});

	it("type identifier is correct", () => {
		const node = deEsser();

		expect(node.type[2]).toBe("de-esser");
	});

	it("split mode: below-threshold input passes through unchanged", () => {
		// A 6 kHz tone at -60 dBFS is far below the default -20 dB threshold.
		// The sidechain envelope never rises above threshold, so the gain
		// reduction is 0 dB and the split-mode formula collapses to the
		// identity `input − band + band × 1 = input`.
		const amplitude = Math.pow(10, -60 / 20);
		const node = deEsser({ frequency: 6000, threshold: -20, ratio: 4, range: -12, mode: "split" });

		const chunks = [makeSineChunk(6000, amplitude, 4096)];
		const outputs = runStream(node, chunks);
		const output = outputs[0]!;
		const inputPeak = peakOf(chunks[0]!);
		const outputPeak = peakOf(output);

		// Expect the output peak to be within a small tolerance of input —
		// a tiny amount of transient biquad settle is acceptable.
		expect(outputPeak).toBeGreaterThan(inputPeak * 0.9);
		expect(outputPeak).toBeLessThan(inputPeak * 1.1);
	});

	it("split mode: 6 kHz tone above threshold is attenuated (primary behavioral claim)", () => {
		// A 6 kHz tone at -6 dBFS is well above the -20 dB threshold.
		// Envelope should climb well past threshold, producing significant
		// gain reduction on the sibilant band.
		const amplitude = Math.pow(10, -6 / 20);
		const node = deEsser({
			frequency: 6000,
			threshold: -20,
			ratio: 8,
			range: -24,
			attack: 1,
			release: 10,
			mode: "split",
		});

		// Run enough chunks for the envelope to reach steady state.
		const chunks = Array.from({ length: 10 }, () => makeSineChunk(6000, amplitude, 4096));
		const outputs = runStream(node, chunks);
		const lastOutput = outputs[outputs.length - 1]!;
		const inputPeak = peakOf(chunks[0]!);
		const outputPeak = peakOf(lastOutput);
		const attenuationDb = 20 * Math.log10(Math.max(outputPeak / inputPeak, 1e-10));

		// The sidechain envelope of a full-scale bandpass-in-band sine is
		// close to the input amplitude (band is at the center frequency).
		// Target reduction ≈ (input_db − threshold) × (1 − 1/ratio)
		// = (−6 − (−20)) × (1 − 1/8) = 14 × 0.875 = 12.25 dB (capped at 24),
		// so ≈ −12 dB attenuation on the sibilant band. In split mode the
		// sibilant band is the signal itself (6 kHz tone is fully in-band),
		// so the overall signal should be attenuated by that amount.
		expect(attenuationDb).toBeLessThan(-6);
		expect(attenuationDb).toBeGreaterThan(-20);
	});

	it("split mode: off-band content is preserved when sibilance is active", () => {
		// Mix a low-frequency carrier (500 Hz, well out of the 6 kHz band)
		// with a sibilant 6 kHz tone. The de-esser should attenuate the
		// sibilant band but leave the low-frequency content largely intact.
		const sibilantAmp = Math.pow(10, -6 / 20);
		const carrierAmp = Math.pow(10, -12 / 20);
		const frames = 8192;
		const mixed = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			mixed[index] =
				sibilantAmp * Math.sin((2 * Math.PI * 6000 * index) / SAMPLE_RATE) +
				carrierAmp * Math.sin((2 * Math.PI * 500 * index) / SAMPLE_RATE);
		}

		const chunk: TestChunk = { samples: [mixed], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const node = deEsser({
			frequency: 6000,
			threshold: -20,
			ratio: 8,
			range: -24,
			attack: 1,
			release: 10,
			mode: "split",
		});

		const outputs = runStream(node, [chunk, chunk, chunk, chunk]);
		const output = outputs[outputs.length - 1]!;

		// Measure the carrier-band RMS contribution by integrating against
		// the 500 Hz sine. This is an inner product — sums to roughly
		// `carrierAmp × frames / 2` when the signal contains a clean
		// 500 Hz component at that amplitude.
		let carrierInner = 0;

		for (let index = 0; index < frames; index++) {
			carrierInner += (output.samples[0]![index] ?? 0) * Math.sin((2 * Math.PI * 500 * index) / SAMPLE_RATE);
		}

		const estimatedCarrierAmp = (2 * carrierInner) / frames;

		// Expect the recovered 500 Hz amplitude to be close to its input
		// amplitude — the carrier is outside the 6 kHz band and must pass
		// through essentially untouched.
		expect(estimatedCarrierAmp).toBeGreaterThan(carrierAmp * 0.7);
		expect(estimatedCarrierAmp).toBeLessThan(carrierAmp * 1.1);
	});

	it("wideband mode: attenuates full signal when sibilance is detected", () => {
		// In wideband mode, triggering on the 6 kHz sidechain should pull
		// down the entire signal. Drive with an in-band 6 kHz tone and
		// verify the total peak is attenuated.
		const amplitude = Math.pow(10, -6 / 20);
		const node = deEsser({
			frequency: 6000,
			threshold: -20,
			ratio: 8,
			range: -24,
			attack: 1,
			release: 10,
			mode: "wideband",
		});

		const chunks = Array.from({ length: 10 }, () => makeSineChunk(6000, amplitude, 4096));
		const outputs = runStream(node, chunks);
		const lastOutput = outputs[outputs.length - 1]!;
		const inputPeak = peakOf(chunks[0]!);
		const outputPeak = peakOf(lastOutput);
		const attenuationDb = 20 * Math.log10(Math.max(outputPeak / inputPeak, 1e-10));

		// Same expected range as the split-mode attenuation test — in both
		// modes the 6 kHz-only signal ends up attenuated by the full
		// ratio-expander amount because the band *is* the whole signal.
		expect(attenuationDb).toBeLessThan(-6);
		expect(attenuationDb).toBeGreaterThan(-20);
	});

	it("wideband mode: reduction is applied to out-of-band content too", () => {
		// Contrast with the split-mode "off-band preserved" test: in
		// wideband mode, a low-frequency carrier is pulled down along with
		// the sibilant band because the gain reduction multiplies the full
		// sample, not just the filtered band.
		const sibilantAmp = Math.pow(10, -6 / 20);
		const carrierAmp = Math.pow(10, -12 / 20);
		const frames = 8192;
		const mixed = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			mixed[index] =
				sibilantAmp * Math.sin((2 * Math.PI * 6000 * index) / SAMPLE_RATE) +
				carrierAmp * Math.sin((2 * Math.PI * 500 * index) / SAMPLE_RATE);
		}

		const chunk: TestChunk = { samples: [mixed], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const node = deEsser({
			frequency: 6000,
			threshold: -20,
			ratio: 8,
			range: -24,
			attack: 1,
			release: 10,
			mode: "wideband",
		});

		const outputs = runStream(node, [chunk, chunk, chunk, chunk]);
		const output = outputs[outputs.length - 1]!;

		let carrierInner = 0;

		for (let index = 0; index < frames; index++) {
			carrierInner += (output.samples[0]![index] ?? 0) * Math.sin((2 * Math.PI * 500 * index) / SAMPLE_RATE);
		}

		const estimatedCarrierAmp = (2 * carrierInner) / frames;

		// The 500 Hz carrier should come out noticeably attenuated —
		// wideband mode applies the full gain reduction to the whole sample.
		expect(estimatedCarrierAmp).toBeLessThan(carrierAmp * 0.7);
	});

	it("handles empty chunk gracefully", () => {
		const node = deEsser();
		const emptyChunk: TestChunk = { samples: [], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const stream = node.createStream();
		const output = stream._unbuffer(emptyChunk);

		expect(output.samples).toHaveLength(0);
	});

	it("handles zero-frame chunk gracefully", () => {
		const node = deEsser();
		const zeroChunk: TestChunk = { samples: [new Float32Array(0)], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const stream = node.createStream();
		const output = stream._unbuffer(zeroChunk);

		expect(output.samples[0]).toHaveLength(0);
	});

	it("produces finite output values", () => {
		const node = deEsser();
		const chunk = makeSineChunk(6000, Math.pow(10, -6 / 20));
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("stereo: both channels de-essed independently", () => {
		// Loud sibilance on L, quiet on R. Only L should be attenuated.
		const loudAmp = Math.pow(10, -6 / 20);
		const quietAmp = Math.pow(10, -60 / 20);
		const frames = 4096;
		const left = new Float32Array(frames);
		const right = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			left[index] = loudAmp * Math.sin((2 * Math.PI * 6000 * index) / SAMPLE_RATE);
			right[index] = quietAmp * Math.sin((2 * Math.PI * 6000 * index) / SAMPLE_RATE);
		}

		const chunk: TestChunk = { samples: [left, right], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const node = deEsser({
			frequency: 6000,
			threshold: -20,
			ratio: 8,
			range: -24,
			attack: 1,
			release: 10,
			mode: "split",
		});

		const chunks = Array.from({ length: 10 }, () => chunk);
		const outputs = runStream(node, chunks);
		const last = outputs[outputs.length - 1]!;

		let lPeak = 0;
		let rPeak = 0;

		for (const sample of last.samples[0]!) {
			const abs = sample >= 0 ? sample : -sample;

			if (abs > lPeak) lPeak = abs;
		}

		for (const sample of last.samples[1]!) {
			const abs = sample >= 0 ? sample : -sample;

			if (abs > rPeak) rPeak = abs;
		}

		// L attenuated (above threshold).
		expect(lPeak).toBeLessThan(loudAmp * 0.7);

		// R passes through essentially untouched (below threshold).
		expect(rPeak).toBeGreaterThan(quietAmp * 0.8);
		expect(rPeak).toBeLessThan(quietAmp * 1.2);
	});

	it("clone preserves and can override properties", () => {
		const node = deEsser({ frequency: 7000, threshold: -24 });
		const cloned = node.clone({ threshold: -18 });

		expect(cloned.properties.frequency).toBe(7000);
		expect(cloned.properties.threshold).toBe(-18);
	});

	it("ratio=1 is a no-op: signal passes through even above threshold", () => {
		// With ratio=1 the slope factor (1 − 1/ratio) is 0, so gain reduction
		// is always 0 dB, and the split-mode subtract/add collapses to identity.
		const amplitude = Math.pow(10, -6 / 20);
		const node = deEsser({ frequency: 6000, threshold: -40, ratio: 1, range: -24, mode: "split" });

		const chunks = [makeSineChunk(6000, amplitude, 4096)];
		const outputs = runStream(node, chunks);
		const inputPeak = peakOf(chunks[0]!);
		const outputPeak = peakOf(outputs[0]!);

		// Small tolerance for biquad transient on first samples.
		expect(outputPeak).toBeGreaterThan(inputPeak * 0.9);
		expect(outputPeak).toBeLessThan(inputPeak * 1.1);
	});
});
