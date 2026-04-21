import { describe, it, expect } from "vitest";
import { gate, GateNode } from ".";

const SAMPLE_RATE = 48000;

function makeConstantChunk(
	value: number,
	frames = 4096,
	channels = 1,
): { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number } {
	return {
		samples: Array.from({ length: channels }, () => new Float32Array(frames).fill(value)),
		offset: 0,
		sampleRate: SAMPLE_RATE,
		bitDepth: 32,
	};
}

function processMultipleChunks(
	node: ReturnType<typeof gate>,
	chunks: Array<ReturnType<typeof makeConstantChunk>>,
): Array<ReturnType<typeof makeConstantChunk>> {
	const stream = node.createStream();

	return chunks.map((chunk) => stream._unbuffer(chunk));
}

describe("GateNode", () => {
	it("has correct static metadata", () => {
		expect(GateNode.moduleName).toBe("Gate");
	});

	it("schema defaults are gate-appropriate", () => {
		const node = gate();

		expect(node.properties.threshold).toBe(-40);
		expect(node.properties.range).toBe(-80);
		expect(node.properties.attack).toBe(1);
		expect(node.properties.hold).toBe(100);
		expect(node.properties.release).toBe(200);
		expect(node.properties.hysteresis).toBe(6);
	});

	it("accepts custom parameters via factory", () => {
		const node = gate({ threshold: -30, hold: 50, range: -60 });

		expect(node.properties.threshold).toBe(-30);
		expect(node.properties.hold).toBe(50);
		expect(node.properties.range).toBe(-60);
	});

	it("signal above threshold: gate is open, passes signal near unity gain", () => {
		// -12dBFS signal, -40 threshold -> gate should be open
		const signal = Math.pow(10, -12 / 20);
		const node = gate({ threshold: -40, range: -80, attack: 0, release: 0, hold: 0, hysteresis: 0 });

		const chunks = Array.from({ length: 100 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);

		// Should be very close to the input signal (gate fully open)
		expect(lastSample).toBeCloseTo(signal, 2);
	});

	it("signal below threshold: gate is closed, attenuates signal toward range floor at high ratio", () => {
		// Input -80 dBFS, 40 dB below threshold. ratio=20 -> slope 0.95 -> target gr = -38 dB.
		// range=-30 clamps attenuation to -30 dB. Output ≈ -110 dBFS.
		const signal = Math.pow(10, -80 / 20);
		const node = gate({ threshold: -40, range: -30, ratio: 20, attack: 0, release: 0, hold: 0, hysteresis: 0 });

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));

		// Expected: -80 + (-30) = -110 dBFS.
		expect(outDb).toBeLessThan(-100);
	});

	it("hold timer: gate stays open after signal drops", () => {
		// Signal above threshold for first chunk, then drops below
		// hold=200ms should keep gate open for 200ms after signal drops
		const signal = Math.pow(10, -12 / 20); // above threshold
		const silence = Math.pow(10, -60 / 20); // below threshold

		const node = gate({
			threshold: -40,
			range: -80,
			attack: 0,
			release: 0,
			hold: 200, // 200ms hold
			hysteresis: 0,
		});

		const stream = node.createStream();

		// Drive gate open with signal chunks
		const signalChunksCount = 10;
		const signalChunks = Array.from({ length: signalChunksCount }, () => makeConstantChunk(signal, 480));

		for (const chunk of signalChunks) {
			stream._unbuffer(chunk);
		}

		// Now switch to silence — gate should still be open (hold)
		// 200ms hold at 48kHz = 9600 samples = 20 chunks of 480 frames
		// First silence chunk should still be near unity (gate open)
		const firstSilenceChunk = makeConstantChunk(silence, 480);
		const firstSilenceOut = stream._unbuffer(firstSilenceChunk);
		const firstSilenceSample = Math.abs(firstSilenceOut.samples[0]![0] ?? 0);

		// Gate should still be open (or mostly open) shortly after signal drops
		// The first silence chunk (within hold time) should pass mostly through
		expect(firstSilenceSample).toBeGreaterThan(silence * 0.5);
	});

	it("hysteresis: prevents chatter — gate stays open in hysteresis band", () => {
		// Signal oscillating near the threshold could cause chattering without hysteresis.
		// With hysteresis=10dB: open at -40, close at -50.
		// Signal at -45dBFS (between open and close thresholds) should not close the gate
		// once it has opened.
		const openSignal = Math.pow(10, -30 / 20); // above open threshold -40
		const hysteresisSignal = Math.pow(10, -45 / 20); // between -40 and -50

		const node = gate({
			threshold: -40,
			range: -80,
			attack: 0,
			release: 0,
			hold: 0,
			hysteresis: 10,
		});

		const stream = node.createStream();

		// Open the gate
		const openChunks = Array.from({ length: 50 }, () => makeConstantChunk(openSignal, 480));

		for (const chunk of openChunks) {
			stream._unbuffer(chunk);
		}

		// Signal in hysteresis band — gate should remain open (not close)
		const hysteresisChunk = makeConstantChunk(hysteresisSignal, 4096);
		const output = stream._unbuffer(hysteresisChunk);
		const lastSample = Math.abs(output.samples[0]![output.samples[0]!.length - 1] ?? 0);

		// Gate should still be open — output close to input level
		expect(lastSample).toBeCloseTo(hysteresisSignal, 2);
	});

	it("handles empty chunk gracefully", () => {
		const node = gate();
		const emptyChunk = { samples: [] as Array<Float32Array>, offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const stream = node.createStream();
		const output = stream._unbuffer(emptyChunk);

		expect(output.samples).toHaveLength(0);
	});

	it("handles zero-frame chunk gracefully", () => {
		const node = gate();
		const zeroChunk = { samples: [new Float32Array(0)], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const stream = node.createStream();
		const output = stream._unbuffer(zeroChunk);

		expect(output.samples[0]).toHaveLength(0);
	});

	it("produces finite output values", () => {
		const node = gate();
		const chunk = makeConstantChunk(Math.pow(10, -12 / 20));
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("stereo: both channels gated independently", () => {
		// Different levels per channel
		const loudSig = Math.pow(10, -12 / 20); // above threshold
		const quietSig = Math.pow(10, -60 / 20); // below threshold

		const chunk = {
			samples: [
				new Float32Array(4096).fill(loudSig),
				new Float32Array(4096).fill(quietSig),
			],
			offset: 0,
			sampleRate: SAMPLE_RATE,
			bitDepth: 32,
		};

		// ratio=20 pushes toward hard-gate behavior for the quiet channel.
		const node = gate({ threshold: -40, range: -80, ratio: 20, attack: 0, release: 0, hold: 0, hysteresis: 0 });
		const chunks = Array.from({ length: 100 }, () => chunk);
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;

		const lOut = Math.abs(last.samples[0]![0] ?? 0);
		const rOut = Math.abs(last.samples[1]![0] ?? 0);

		// L (loud): gate open, near input level
		expect(lOut).toBeCloseTo(loudSig, 2);

		// R (quiet, -60 dBFS, 20 dB below threshold): ratio=20 -> target gr ≈ -19 dB.
		// Output ≈ -79 dBFS; well under the input level.
		expect(rOut).toBeLessThan(quietSig * 0.2);
	});

	it("schema default ratio is 10", () => {
		const node = gate();

		expect(node.properties.ratio).toBe(10);
	});

	it("ratio=1: no gating — signal passes unchanged even well below threshold", () => {
		// With ratio=1 the expander slope factor is 0, so closed-state gain reduction is 0 dB.
		// Signal well below threshold should still pass through at unity gain.
		const signal = Math.pow(10, -60 / 20); // -60 dBFS
		const node = gate({
			threshold: -40,
			range: -80,
			ratio: 1,
			attack: 0,
			release: 0,
			hold: 0,
			hysteresis: 0,
		});

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);

		// Output should be approximately equal to input (no gating applied)
		expect(lastSample).toBeCloseTo(signal, 4);
	});

	it("ratio=20: strong gating — attenuation approaches range floor", () => {
		// With ratio=20 the slope factor is 0.95.
		// Signal 20 dB below threshold → target gr = -20 * 0.95 = -19 dB,
		// but the state machine marks the gate closed so we saturate toward range.
		// With range = -40 and high ratio, steady-state output should land near the range floor.
		const signal = Math.pow(10, -60 / 20); // -60 dBFS (20 dB below threshold)
		const node = gate({
			threshold: -40,
			range: -40,
			ratio: 20,
			attack: 0,
			release: 0,
			hold: 0,
			hysteresis: 0,
		});

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));
		const inDb = 20 * Math.log10(signal);
		const attenuationDb = outDb - inDb;

		// With input 20 dB below threshold and slope factor 0.95, target gr = -19 dB.
		// range = -40 so the -19 dB value wins the max(). Expect attenuation near -19 dB.
		expect(attenuationDb).toBeLessThan(-15);
		expect(attenuationDb).toBeGreaterThan(-25);
	});

	it("ratio=20 with deep input below threshold: saturates at range floor", () => {
		// Input 40 dB below threshold: target gr = -40 * 0.95 = -38 dB, but range = -30
		// clamps attenuation at -30 dB.
		const signal = Math.pow(10, -80 / 20); // -80 dBFS
		const node = gate({
			threshold: -40,
			range: -30,
			ratio: 20,
			attack: 0,
			release: 0,
			hold: 0,
			hysteresis: 0,
		});

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));
		const inDb = 20 * Math.log10(signal);
		const attenuationDb = outDb - inDb;

		// Attenuation should land at the range floor (-30 dB), not exceed it.
		expect(attenuationDb).toBeCloseTo(-30, 0);
	});

	it("intermediate ratios produce proportional attenuation", () => {
		// For a signal 10 dB below threshold, target gr = -10 * (1 - 1/ratio) dB.
		// ratio=2  -> -10 * 0.5 = -5 dB
		// ratio=4  -> -10 * 0.75 = -7.5 dB
		// ratio=10 -> -10 * 0.9 = -9 dB
		// Attenuation should increase monotonically with ratio.
		const signal = Math.pow(10, -50 / 20); // 10 dB below threshold
		const ratios = [2, 4, 10];
		const attenuations: Array<number> = [];

		for (const ratio of ratios) {
			const node = gate({
				threshold: -40,
				range: -80,
				ratio,
				attack: 0,
				release: 0,
				hold: 0,
				hysteresis: 0,
			});

			const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
			const outputs = processMultipleChunks(node, chunks);
			const last = outputs[outputs.length - 1]!;
			const lastSample = Math.abs(last.samples[0]![0] ?? 0);
			const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));
			const inDb = 20 * Math.log10(signal);

			attenuations.push(outDb - inDb);
		}

		// Monotonic: higher ratio -> more attenuation (more negative dB)
		expect(attenuations[0]!).toBeGreaterThan(attenuations[1]!);
		expect(attenuations[1]!).toBeGreaterThan(attenuations[2]!);

		// Check expected values within ~1 dB tolerance (EMA is instant with attack=release=0)
		expect(attenuations[0]!).toBeCloseTo(-5, 0);
		expect(attenuations[1]!).toBeCloseTo(-7.5, 0);
		expect(attenuations[2]!).toBeCloseTo(-9, 0);
	});

	it("clone preserves and can override properties", () => {
		const node = gate({ threshold: -30, hold: 50 });
		const cloned = node.clone({ hold: 200 });

		expect(cloned.properties.threshold).toBe(-30);
		expect(cloned.properties.hold).toBe(200);
	});

	it("type identifier is correct", () => {
		const node = gate();

		expect(node.type[2]).toBe("gate");
	});
});
