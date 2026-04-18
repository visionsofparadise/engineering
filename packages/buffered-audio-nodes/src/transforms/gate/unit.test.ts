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

	it("signal below threshold: gate is closed, attenuates signal by range", () => {
		// -80dBFS signal, -40 threshold -> gate should be closed
		// range=-60 means -60dB attenuation
		const signal = Math.pow(10, -50 / 20);
		const node = gate({ threshold: -40, range: -60, attack: 0, release: 0, hold: 0, hysteresis: 0 });

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));

		// Expected: -50 + (-60) attenuation = -110dBFS range
		// Actually: output = signal * rangeLinear -> outDb = -50 + (-60) = -110
		expect(outDb).toBeLessThan(-80);
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

		const node = gate({ threshold: -40, range: -80, attack: 0, release: 0, hold: 0, hysteresis: 0 });
		const chunks = Array.from({ length: 100 }, () => chunk);
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;

		const lOut = Math.abs(last.samples[0]![0] ?? 0);
		const rOut = Math.abs(last.samples[1]![0] ?? 0);

		// L (loud): gate open, near input level
		expect(lOut).toBeCloseTo(loudSig, 2);

		// R (quiet): gate closed, heavily attenuated
		expect(rOut).toBeLessThan(quietSig * 0.1);
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
