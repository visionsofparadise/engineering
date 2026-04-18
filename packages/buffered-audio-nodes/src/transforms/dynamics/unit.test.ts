import { describe, it, expect } from "vitest";
import { dynamics, DynamicsNode } from ".";
import { compressor, CompressorNode } from "../compressor";
import { limiter, LimiterNode } from "../limiter";

const SAMPLE_RATE = 48000;

/**
 * Generate a chunk filled with a constant sample value (DC signal).
 */
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

/**
 * Run a single chunk through a dynamics stream.
 */
function processChunk(
	node: ReturnType<typeof dynamics> | ReturnType<typeof compressor> | ReturnType<typeof limiter>,
	chunk: ReturnType<typeof makeConstantChunk>,
): ReturnType<typeof makeConstantChunk> {
	const stream = node.createStream();

	return stream._unbuffer(chunk);
}

/**
 * Run multiple chunks through the same stream and return the last output.
 * Used to drive the envelope to steady state.
 */
function processMultipleChunks(
	node: ReturnType<typeof dynamics> | ReturnType<typeof compressor> | ReturnType<typeof limiter>,
	chunks: Array<ReturnType<typeof makeConstantChunk>>,
): Array<ReturnType<typeof makeConstantChunk>> {
	const stream = node.createStream();

	return chunks.map((chunk) => stream._unbuffer(chunk));
}

describe("DynamicsNode", () => {
	it("has correct static metadata", () => {
		expect(DynamicsNode.moduleName).toBe("Dynamics");
	});

	it("schema defaults are valid", () => {
		const node = dynamics();

		expect(node.properties.threshold).toBe(-24);
		expect(node.properties.ratio).toBe(4);
		expect(node.properties.attack).toBe(10);
		expect(node.properties.release).toBe(100);
		expect(node.properties.knee).toBe(6);
		expect(node.properties.makeupGain).toBe(0);
		expect(node.properties.lookahead).toBe(0);
		expect(node.properties.detection).toBe("peak");
		expect(node.properties.mode).toBe("downward");
		expect(node.properties.stereoLink).toBe("average");
		expect(node.properties.oversampling).toBe(1);
	});

	it("passes signal unchanged when below threshold (no compression)", () => {
		// Signal at -48dBFS, threshold at -24dBFS -> no compression
		const level = Math.pow(10, -48 / 20); // -48dBFS
		const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, makeupGain: 0 });
		const chunk = makeConstantChunk(level);
		const output = processChunk(node, chunk);

		// All samples should be near unchanged
		const firstOut = output.samples[0]![0] ?? 0;

		expect(firstOut).toBeCloseTo(level, 4);
	});

	it("compresses signal above threshold at the expected ratio", () => {
		// Threshold = -24dBFS, ratio = 2:1, hard knee
		// Signal at -18dBFS (6dB above threshold)
		// Expected: gain reduction = 6 * (1 - 1/2) = 3dB
		const threshold = -24;
		const ratio = 2;
		const signalDb = -18;
		const signal = Math.pow(10, signalDb / 20);

		const node = dynamics({ threshold, ratio, knee: 0, attack: 0, release: 0, makeupGain: 0 });
		// Process many chunks to fully settle the envelope
		const chunks = Array.from({ length: 100 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOutput = outputs[outputs.length - 1]!;
		const lastSample = lastOutput.samples[0]![lastOutput.samples[0]!.length - 1] ?? 0;

		const outputDb = 20 * Math.log10(Math.max(Math.abs(lastSample), 1e-10));

		// Expected output at -18 + (-3) = -21dBFS
		expect(outputDb).toBeCloseTo(-21, 0);
	});

	it("envelope attack: gain reduction builds up over attack time", () => {
		// Signal at -12dBFS (12dB above -24 threshold), ratio=4, attack=100ms
		// The first chunk should have less gain reduction than later chunks
		const signalDb = -12;
		const signal = Math.pow(10, signalDb / 20);

		const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 100, release: 100, makeupGain: 0 });
		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal, 480));
		const outputs = processMultipleChunks(node, chunks);

		const firstOut = outputs[0]!;
		const lastOut = outputs[outputs.length - 1]!;

		const firstSample = Math.abs(firstOut.samples[0]![0] ?? 0);
		const lastSample = Math.abs(lastOut.samples[0]![lastOut.samples[0]!.length - 1] ?? 0);

		// After attack, the output level should be lower (more compressed)
		// than at the very start
		expect(lastSample).toBeLessThan(firstSample);
	});

	it("envelope release: gain returns toward unity after signal drops", () => {
		const signalDb = -12;
		const signal = Math.pow(10, signalDb / 20);

		const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 200, makeupGain: 0 });

		// First: drive envelope to steady-state compression with many chunks
		const steadyChunks = Array.from({ length: 100 }, () => makeConstantChunk(signal, 480));
		const silentChunks = Array.from({ length: 200 }, () => makeConstantChunk(0.0001, 480)); // near-silence

		const stream = node.createStream();
		const steadyOutputs = steadyChunks.map((c) => stream._unbuffer(c));
		const releaseOutputs = silentChunks.map((c) => stream._unbuffer(c));

		const steadyLast = steadyOutputs[steadyOutputs.length - 1]!;
		const releaseLast = releaseOutputs[releaseOutputs.length - 1]!;

		// During release, the small signal should pass more gain than the steady-state compressed signal
		const steadySample = Math.abs(steadyLast.samples[0]![0] ?? 0);
		const releaseSample = Math.abs(releaseLast.samples[0]![0] ?? 0);

		// After release, gain should be higher per unit of input signal
		// The near-silence times gainAtRelease should be very close to the near-silence value
		// (close to unity gain) vs the steady state compressed large signal
		const steadyGain = steadySample / signal;
		const releaseGain = releaseSample / 0.0001;

		expect(releaseGain).toBeGreaterThan(steadyGain);
	});

	it("hard knee: immediate compression onset at threshold", () => {
		// Just above threshold should get full ratio reduction immediately
		const threshold = -24;
		const ratio = 4;
		const signal = Math.pow(10, (threshold + 1) / 20); // 1dB above threshold

		const node = dynamics({ threshold, ratio, knee: 0, attack: 0, release: 0, makeupGain: 0 });
		const chunks = Array.from({ length: 50 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOut = outputs[outputs.length - 1]!;
		const lastSample = lastOut.samples[0]![0] ?? 0;
		const outDb = 20 * Math.log10(Math.max(Math.abs(lastSample), 1e-10));

		// Expected: 1dB excess, ratio 4 -> reduction = 1*(1-1/4) = 0.75dB -> output = threshold + 0.25dB
		expect(outDb).toBeCloseTo(threshold + 0.25, 0);
	});

	it("makeup gain is applied after compression", () => {
		const signal = Math.pow(10, -12 / 20); // -12dBFS
		const makeupGain = 6; // +6dB

		const nodeNoMakeup = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, makeupGain: 0 });
		const nodeWithMakeup = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, makeupGain });

		const chunks = Array.from({ length: 50 }, () => makeConstantChunk(signal));

		const outputsNo = processMultipleChunks(nodeNoMakeup, chunks);
		const outputsWith = processMultipleChunks(nodeWithMakeup, chunks);

		const lastNo = Math.abs(outputsNo[outputsNo.length - 1]!.samples[0]![0] ?? 0);
		const lastWith = Math.abs(outputsWith[outputsWith.length - 1]!.samples[0]![0] ?? 0);

		// Makeup should apply +6dB
		const ratio = lastWith / lastNo;

		expect(ratio).toBeCloseTo(Math.pow(10, makeupGain / 20), 2);
	});

	it("stereoLink average: both channels receive same gain reduction", () => {
		// Different levels per channel; linked average should compress both equally
		const chunkCustom = {
			samples: [
				new Float32Array(1024).fill(Math.pow(10, -12 / 20)), // L: loud
				new Float32Array(1024).fill(Math.pow(10, -36 / 20)), // R: quiet
			],
			offset: 0,
			sampleRate: SAMPLE_RATE,
			bitDepth: 32,
		};

		const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, stereoLink: "average" });
		const chunks = Array.from({ length: 50 }, () => chunkCustom);
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;

		// Both channels are compressed by the same linked gain
		// The gain factor applied to L and R should be identical
		const lInput = chunkCustom.samples[0]![0] ?? 0;
		const rInput = chunkCustom.samples[1]![0] ?? 0;
		const lOut = last.samples[0]![0] ?? 0;
		const rOut = last.samples[1]![0] ?? 0;

		const lGain = lOut / lInput;
		const rGain = rOut / rInput;

		expect(lGain).toBeCloseTo(rGain, 3);
	});

	it("stereoLink none: each channel is compressed independently", () => {
		// Different levels; with no link, L (loud) gets compression, R (quiet) does not
		const chunkCustom = {
			samples: [
				new Float32Array(1024).fill(Math.pow(10, -12 / 20)), // L: -12dBFS (above -24 threshold)
				new Float32Array(1024).fill(Math.pow(10, -48 / 20)), // R: -48dBFS (below threshold)
			],
			offset: 0,
			sampleRate: SAMPLE_RATE,
			bitDepth: 32,
		};

		const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, stereoLink: "none" });
		const chunks = Array.from({ length: 50 }, () => chunkCustom);
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;

		const lInput = chunkCustom.samples[0]![0] ?? 0;
		const rInput = chunkCustom.samples[1]![0] ?? 0;
		const lOut = last.samples[0]![0] ?? 0;
		const rOut = last.samples[1]![0] ?? 0;

		const lGain = lOut / lInput;
		const rGain = rOut / rInput;

		// L should have gain reduction, R should be near unity
		expect(lGain).toBeLessThan(0.9);
		expect(rGain).toBeCloseTo(1, 1);
	});

	it("handles empty chunk gracefully", () => {
		const node = dynamics();
		const emptyChunk = { samples: [] as Array<Float32Array>, offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const output = processChunk(node, emptyChunk);

		expect(output.samples).toHaveLength(0);
	});

	it("handles zero-frame chunk gracefully", () => {
		const node = dynamics();
		const zeroChunk = { samples: [new Float32Array(0)], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
		const output = processChunk(node, zeroChunk);

		expect(output.samples[0]).toHaveLength(0);
	});

	describe("upward mode", () => {
		it("boosts signal below threshold", () => {
			// Signal at -36dBFS, threshold at -24dBFS, upward expansion at ratio 2
			const signal = Math.pow(10, -36 / 20);
			const node = dynamics({ threshold: -24, ratio: 2, knee: 0, attack: 0, release: 0, mode: "upward", makeupGain: 0 });

			const chunks = Array.from({ length: 50 }, () => makeConstantChunk(signal));
			const outputs = processMultipleChunks(node, chunks);
			const lastOut = outputs[outputs.length - 1]!;
			const lastSample = Math.abs(lastOut.samples[0]![0] ?? 0);
			const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));

			// 12dB below threshold at ratio 2: expansion = 12*(2-1) = 12dB gain
			// output should be closer to -24dBFS
			expect(outDb).toBeGreaterThan(-36);
		});
	});

	describe("RMS detection", () => {
		it("processes a signal with RMS detection without errors", () => {
			const signal = Math.pow(10, -12 / 20);
			const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, detection: "rms" });
			const chunk = makeConstantChunk(signal);
			const output = processChunk(node, chunk);

			expect(output.samples[0]).toBeDefined();
			expect(Number.isFinite(output.samples[0]![0])).toBe(true);
		});
	});

	describe("lookahead + detection mode", () => {
		it("lookahead path routes detection parameter through detectLevels: both modes run and produce valid output", () => {
			// Verifies Issue 1 fix: the lookahead path calls detectLevels (honoring the
			// detection parameter) rather than hardcoding Math.abs (peak).
			//
			// Architecture note: the lookahead path processes sample-by-sample, wrapping
			// each sample in a 1-element Float32Array before calling detectLevels. For a
			// 1-element window, peak(|x|) == rms(sqrt(x^2/1)) == |x|, so both detection
			// modes produce numerically identical output in this path. The behavioral
			// difference between modes (RMS ~3dB lower than peak on a sine wave) only
			// emerges over multi-sample windows; that difference is tested by the
			// non-lookahead RMS test above. What this test verifies is that the lookahead
			// path does not crash or produce NaN/Infinity when detection="rms" is set.
			const frames = 4096;
			const sampleRate = SAMPLE_RATE;
			const freqHz = 1000;
			const amplitude = Math.pow(10, -12 / 20);

			const sineData = new Float32Array(frames);

			for (let i = 0; i < frames; i++) {
				sineData[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
			}

			const sineChunk = { samples: [sineData], offset: 0, sampleRate, bitDepth: 32 };

			const nodePeak = dynamics({ lookahead: 5, detection: "peak", threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, makeupGain: 0 });
			const nodeRms = dynamics({ lookahead: 5, detection: "rms", threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, makeupGain: 0 });

			const streamPeak = nodePeak.createStream();
			const streamRms = nodeRms.createStream();

			const repeatChunks = Array.from({ length: 10 }, () => sineChunk);

			let peakOutput: typeof sineChunk | null = null;
			let rmsOutput: typeof sineChunk | null = null;

			for (const chunk of repeatChunks) {
				peakOutput = streamPeak._unbuffer(chunk);
				rmsOutput = streamRms._unbuffer(chunk);
			}

			// Both modes must produce finite non-NaN output
			for (const s of peakOutput!.samples[0]!) {
				expect(Number.isFinite(s)).toBe(true);
			}

			for (const s of rmsOutput!.samples[0]!) {
				expect(Number.isFinite(s)).toBe(true);
			}

			// Output must be non-zero (signal passes through with compression applied)
			const peakMax = peakOutput!.samples[0]!.reduce((acc, s) => Math.max(acc, Math.abs(s)), 0);
			const rmsMax = rmsOutput!.samples[0]!.reduce((acc, s) => Math.max(acc, Math.abs(s)), 0);

			expect(peakMax).toBeGreaterThan(0);
			expect(rmsMax).toBeGreaterThan(0);
		});
	});
});

describe("CompressorNode", () => {
	it("has correct static metadata", () => {
		expect(CompressorNode.moduleName).toBe("Compressor");
	});

	it("schema defaults match compression presets", () => {
		const node = compressor();

		expect(node.properties.threshold).toBe(-24);
		expect(node.properties.ratio).toBe(4);
		expect(node.properties.attack).toBe(10);
		expect(node.properties.release).toBe(100);
		expect(node.properties.knee).toBe(6);
	});

	it("produces compressed output above threshold", () => {
		const signal = Math.pow(10, -12 / 20); // -12dBFS (12dB above -24 threshold)
		const node = compressor({ threshold: -24, ratio: 4 });

		const chunks = Array.from({ length: 100 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOut = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(lastOut.samples[0]![0] ?? 0);

		// Output should be less than input (compression applied)
		expect(lastSample).toBeLessThan(signal);
	});
});

describe("LimiterNode", () => {
	it("has correct static metadata", () => {
		expect(LimiterNode.moduleName).toBe("Limiter");
	});

	it("schema defaults are limiter-appropriate", () => {
		const node = limiter();

		expect(node.properties.threshold).toBe(-1);
		expect(node.properties.attack).toBe(1);
		expect(node.properties.release).toBe(50);
		expect(node.properties.oversampling).toBe(2);
	});

	it("hard-limits signal approaching 0dBFS", () => {
		// A signal significantly above -1dBFS threshold should be severely limited
		const signal = 0.99; // near full scale
		const node = limiter({ threshold: -1 });

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOut = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(lastOut.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));

		// Output should be at or near -1dBFS
		expect(outDb).toBeLessThanOrEqual(-0.5);
	});
});

describe("Oversampling integration", () => {
	it("DynamicsNode with oversampling=2 produces finite output", () => {
		const signal = Math.pow(10, -6 / 20); // near full scale
		const node = dynamics({ threshold: -12, ratio: 4, knee: 0, attack: 0, release: 0, oversampling: 2 });

		const chunks = Array.from({ length: 10 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOut = outputs[outputs.length - 1]!;

		for (const sample of lastOut.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("DynamicsNode with oversampling=2 compresses signal above threshold", () => {
		// Oversampled path should still reduce gain above threshold
		const signal = Math.pow(10, -12 / 20); // -12dBFS (above -24 threshold)
		const node = dynamics({ threshold: -24, ratio: 4, knee: 0, attack: 0, release: 0, oversampling: 2 });

		const chunks = Array.from({ length: 100 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOut = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(lastOut.samples[0]![0] ?? 0);

		// Output should be compressed (less than input)
		expect(lastSample).toBeLessThan(signal);
	});

	it("LimiterNode (oversampling=2 by default) passes existing hard-limit test", () => {
		const signal = 0.99; // near full scale
		const node = limiter({ threshold: -1 });

		// Verify oversampling defaults to 2 (on)
		expect(node.properties.oversampling).toBe(2);

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const lastOut = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(lastOut.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));

		expect(outDb).toBeLessThanOrEqual(-0.5);
	});

	it("oversampled output differs from non-oversampled output for strong compression", () => {
		// On a high-frequency test signal with high ratio, oversampling changes
		// the gain computation timing relative to the direct path.
		const frames = 4096;
		const freqHz = 8000; // High frequency where oversampling has most effect
		const signal = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			signal[index] = 0.9 * Math.sin((2 * Math.PI * freqHz * index) / SAMPLE_RATE);
		}

		const chunk = { samples: [signal], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const nodeNoOversampling = dynamics({ threshold: -6, ratio: 20, knee: 0, attack: 0, release: 0, oversampling: 1 });
		const nodeOversampled = dynamics({ threshold: -6, ratio: 20, knee: 0, attack: 0, release: 0, oversampling: 2 });

		// Warm up both streams
		const streamNo = nodeNoOversampling.createStream();
		const streamYes = nodeOversampled.createStream();

		for (let rep = 0; rep < 5; rep++) {
			streamNo._unbuffer(chunk);
			streamYes._unbuffer(chunk);
		}

		const outNo = streamNo._unbuffer(chunk);
		const outYes = streamYes._unbuffer(chunk);

		// Both outputs must be finite
		for (const sample of outNo.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		for (const sample of outYes.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		// The oversampled output should differ from the non-oversampled output,
		// demonstrating the integration is active.
		let maxDiff = 0;

		for (let index = 0; index < frames; index++) {
			const diff = Math.abs((outNo.samples[0]![index] ?? 0) - (outYes.samples[0]![index] ?? 0));

			if (diff > maxDiff) maxDiff = diff;
		}

		expect(maxDiff).toBeGreaterThan(1e-6);
	});

	it("lookahead + oversampling compose: gain is reduced on a signal above threshold with both active", () => {
		// With both lookahead and oversampling configured, the oversampled path
		// must produce alias-free gain computation and the lookahead path must
		// delay the audio. Neither feature silently drops the other.
		const frames = 4096;
		const freqHz = 5000;
		const threshold = -12;
		const signalLevel = Math.pow(10, -3 / 20); // well above threshold

		const sineData = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			sineData[index] = signalLevel * Math.sin((2 * Math.PI * freqHz * index) / SAMPLE_RATE);
		}

		const chunk = { samples: [sineData], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const node = dynamics({
			threshold,
			ratio: 10,
			knee: 0,
			attack: 1,
			release: 50,
			makeupGain: 0,
			lookahead: 5,
			oversampling: 2,
			stereoLink: "none",
		});

		const stream = node.createStream();

		// Warm up the envelope and lookahead buffer
		for (let rep = 0; rep < 10; rep++) {
			stream._unbuffer(chunk);
		}

		const output = stream._unbuffer(chunk);
		const outCh = output.samples[0]!;

		// Measure peak of second half (settled)
		const half = Math.floor(frames / 2);
		let inPeak = 0;
		let outPeak = 0;

		for (let index = half; index < frames; index++) {
			const inSample = Math.abs(sineData[index] ?? 0);
			const outSample = Math.abs(outCh[index] ?? 0);

			if (inSample > inPeak) inPeak = inSample;

			if (outSample > outPeak) outPeak = outSample;
		}

		// Gain reduction should be active — output peak strictly below input peak.
		expect(outPeak).toBeLessThan(inPeak);

		// All samples finite
		for (const sample of outCh) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("oversampled stereo DynamicsNode produces finite output for both channels", () => {
		const signal = Math.pow(10, -6 / 20);
		const node = dynamics({ threshold: -12, ratio: 4, knee: 0, attack: 0, release: 0, oversampling: 2, stereoLink: "average" });
		const chunk = {
			samples: [new Float32Array(1024).fill(signal), new Float32Array(1024).fill(signal * 0.7)],
			offset: 0,
			sampleRate: SAMPLE_RATE,
			bitDepth: 32,
		};

		const stream = node.createStream();

		for (let rep = 0; rep < 5; rep++) {
			stream._unbuffer(chunk);
		}

		const output = stream._unbuffer(chunk);

		expect(output.samples).toHaveLength(2);

		for (const ch of output.samples) {
			for (const sample of ch) {
				expect(Number.isFinite(sample)).toBe(true);
			}
		}
	});

	it("true-peak detection: inter-sample peaks above threshold trigger gain reduction only at factor > 1", () => {
		// Construct a high-frequency sine whose sampled |x| stays below
		// threshold but whose reconstructed inter-sample peak exceeds it.
		// oversampling=1 should pass the signal unchanged; oversampling=2
		// should detect the true peak and apply gain reduction.
		//
		// At 12000 Hz with 48000 Hz sample rate, the sine has exactly 4 samples
		// per cycle. A 0.5-sample phase offset places samples at ±sin(π/4) =
		// ±0.707 times the amplitude, while the true peak between samples
		// equals the full amplitude. At amplitude 0.95, sampled |x| ≈ 0.672
		// (−3.4 dB) while the inter-sample peak reaches 0.95 (−0.45 dB).
		// With a threshold of −3 dB (≈ 0.708) and phase offset 0.5, sampled
		// peaks sit right at/below threshold, while the inter-sample peaks
		// are a full 2.5 dB above it — a large, unambiguous gap.
		const frames = 4096;
		const freqHz = 12000;
		const amplitude = 0.95;
		const sineData = new Float32Array(frames);
		const phaseOffset = 0.5;

		for (let index = 0; index < frames; index++) {
			sineData[index] = amplitude * Math.sin((2 * Math.PI * freqHz * (index + phaseOffset)) / SAMPLE_RATE);
		}

		const chunk = { samples: [sineData], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		// At factor=1 sampled peaks (0.672) stay just below threshold (0.708):
		// no reduction. At factor=4 the reconstruction cleanly recovers the
		// inter-sample peak (0.95), well above threshold → large reduction.
		const nodeNo = dynamics({ threshold: -3, ratio: 100, knee: 0, attack: 0, release: 0, oversampling: 1 });
		const nodeYes = dynamics({ threshold: -3, ratio: 100, knee: 0, attack: 0, release: 0, oversampling: 4 });

		const streamNo = nodeNo.createStream();
		const streamYes = nodeYes.createStream();

		for (let rep = 0; rep < 5; rep++) {
			streamNo._unbuffer(chunk);
			streamYes._unbuffer(chunk);
		}

		const outNo = streamNo._unbuffer(chunk);
		const outYes = streamYes._unbuffer(chunk);

		const half = Math.floor(frames / 2);
		let sumSqInput = 0;
		let sumSqNo = 0;
		let sumSqYes = 0;

		for (let index = half; index < frames; index++) {
			sumSqInput += (sineData[index] ?? 0) ** 2;
			sumSqNo += (outNo.samples[0]![index] ?? 0) ** 2;
			sumSqYes += (outYes.samples[0]![index] ?? 0) ** 2;
		}

		const rmsInput = Math.sqrt(sumSqInput / (frames - half));
		const rmsNo = Math.sqrt(sumSqNo / (frames - half));
		const rmsYes = Math.sqrt(sumSqYes / (frames - half));

		// Non-oversampled: sample peaks stay below threshold, no reduction.
		// Output RMS ≈ input RMS.
		expect(rmsNo).toBeCloseTo(rmsInput, 2);

		// Oversampled: inter-sample peak exceeds threshold, reduction applied.
		// Output RMS strictly below non-oversampled output RMS.
		expect(rmsYes).toBeLessThan(rmsNo * 0.95);
	});

	it("envelope timing is invariant under oversampling factor", () => {
		// Attack-time semantics must not change with oversampling. For a
		// given attack in ms, gain reduction should build up over the same
		// wall-clock duration at factor=1 and factor=4. This catches the
		// prior bug where the envelope advanced at the oversampled rate
		// with original-rate coefficients — making attack/release
		// effectively factor× too fast.
		//
		// Approach: feed a long warmup to let the oversampler LP settle,
		// then in a fresh chunk observe the envelope attack response.
		// A DC signal gives identical detected levels across factors once
		// the filter has settled, so the envelope trajectories must match.
		const frames = 4096;
		const attackMs = 20;
		const signal = Math.pow(10, -6 / 20); // above -24 dBFS threshold

		const chunk = {
			samples: [new Float32Array(frames).fill(signal)],
			offset: 0,
			sampleRate: SAMPLE_RATE,
			bitDepth: 32,
		};

		function measureAttackTrajectory(factor: 1 | 4): Array<number> {
			const node = dynamics({
				threshold: -24,
				ratio: 4,
				knee: 0,
				attack: attackMs,
				release: 5000,
				makeupGain: 0,
				oversampling: factor,
			});

			const stream = node.createStream();

			// Reset the envelope state by reading internal state indirectly:
			// we actually want a fresh envelope but warm LP filter. The
			// simplest cross-cutting approach is to process one chunk to
			// settle the LP filter on a DC input, then freeze the envelope
			// response by constructing a fresh stream... but we cannot reuse
			// stream state. Instead we compare ratios at settled times where
			// the LP startup transient is already gone (ms >= 5 at 48 kHz).
			const out = stream._unbuffer(chunk);
			const outCh = out.samples[0]!;

			const samplesPerMs = Math.floor(SAMPLE_RATE / 1000);
			const trajectory: Array<number> = [];

			for (let ms = 0; ms <= 80; ms++) {
				const idx = Math.min(frames - 1, ms * samplesPerMs);
				const gain = (outCh[idx] ?? 0) / signal;

				trajectory.push(gain);
			}

			return trajectory;
		}

		const trajectory1 = measureAttackTrajectory(1);
		const trajectory4 = measureAttackTrajectory(4);

		// Compare at wall-clock time points after the LP startup transient.
		// The envelope smoothing coefficients must match, so once the
		// detected level settles, the attack curves must coincide. We
		// demand that the time-to-reach-half-attack differs by no more
		// than a few percent between the two factors — catching the factor×
		// bug where attack would be 4× faster.
		function halfAttackMs(trajectory: Array<number>): number {
			const settled = trajectory[trajectory.length - 1] ?? 1;
			const startGain = 1;
			const halfGain = startGain + (settled - startGain) * 0.5;

			for (let ms = 0; ms < trajectory.length; ms++) {
				const gain = trajectory[ms] ?? 1;

				if (gain <= halfGain) return ms;
			}

			return trajectory.length;
		}

		const half1 = halfAttackMs(trajectory1);
		const half4 = halfAttackMs(trajectory4);

		// Under the bug, half4 would be ~1/4 of half1. Under the fixed
		// implementation, they should be nearly equal.
		expect(Math.abs(half1 - half4)).toBeLessThan(Math.max(3, half1 * 0.25));
		expect(half1).toBeGreaterThan(0);
		expect(half4).toBeGreaterThan(0);
		// Sanity: the time should be roughly in the expected attack-ms range.
		expect(half1).toBeGreaterThan(5);
		expect(half4).toBeGreaterThan(5);
	});
});
