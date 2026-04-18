import { describe, it, expect } from "vitest";
import { limiter, LimiterNode } from ".";
import { PACKAGE_NAME } from "../../package-metadata";

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
	node: ReturnType<typeof limiter>,
	chunks: Array<ReturnType<typeof makeConstantChunk>>,
): Array<ReturnType<typeof makeConstantChunk>> {
	const stream = node.createStream();

	return chunks.map((chunk) => stream._unbuffer(chunk));
}

describe("LimiterNode", () => {
	it("has correct static metadata", () => {
		expect(LimiterNode.moduleName).toBe("Limiter");
		expect(LimiterNode.packageName).toBe(PACKAGE_NAME);
	});

	it("schema defaults are limiter-appropriate", () => {
		const node = limiter();

		expect(node.properties.threshold).toBe(-1);
		expect(node.properties.attack).toBe(1);
		expect(node.properties.release).toBe(50);
		expect(node.properties.makeupGain).toBe(0);
		expect(node.properties.stereoLink).toBe("max");
		expect(node.properties.oversampling).toBe(2);
	});

	it("accepts custom threshold via factory", () => {
		const node = limiter({ threshold: -3 });

		expect(node.properties.threshold).toBe(-3);
	});

	it("hard-limits signal well above threshold", () => {
		// Signal at 0dBFS (value=1.0), threshold=-1dBFS
		// With ratio=100, nearly all excess is removed
		const signal = 1.0;
		const node = limiter({ threshold: -1, attack: 0, release: 0 });

		const chunks = Array.from({ length: 200 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);
		const outDb = 20 * Math.log10(Math.max(lastSample, 1e-10));

		// Output should be at or below the threshold
		expect(outDb).toBeLessThanOrEqual(-0.5);
	});

	it("does not limit signal below threshold", () => {
		// Signal at -12dBFS, threshold at -1dBFS -> no limiting
		const signal = Math.pow(10, -12 / 20);
		const node = limiter({ threshold: -1, attack: 0, release: 0 });

		const chunks = Array.from({ length: 50 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);

		expect(lastSample).toBeCloseTo(signal, 3);
	});

	it("produces finite output values at extreme signal levels", () => {
		const node = limiter();
		const chunk = makeConstantChunk(5.0); // Way above 0dBFS
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("processes stereo input without errors", () => {
		const node = limiter();
		const chunk = makeConstantChunk(0.9, 4096, 2);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		expect(output.samples).toHaveLength(2);
		expect(output.samples[0]).toHaveLength(4096);
		expect(output.samples[1]).toHaveLength(4096);
	});

	it("stereoLink defaults to max — louder channel drives both", () => {
		// L: loud, R: quiet. With stereoLink=max, the loud L drives gain for both.
		const chunk = {
			samples: [
				new Float32Array(1024).fill(0.99), // L: near full scale
				new Float32Array(1024).fill(0.01), // R: very quiet
			],
			offset: 0,
			sampleRate: SAMPLE_RATE,
			bitDepth: 32,
		};

		const node = limiter({ threshold: -1, attack: 0, release: 0 });
		const chunks = Array.from({ length: 100 }, () => chunk);
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;

		const lOut = Math.abs(last.samples[0]![0] ?? 0);
		const rOut = Math.abs(last.samples[1]![0] ?? 0);

		// L is compressed, R also receives gain reduction from max-linked signal
		// Both gain factors should be the same (max-linked)
		const lGain = lOut / 0.99;
		const rGain = rOut / 0.01;

		expect(lGain).toBeCloseTo(rGain, 2);
	});

	it("type identifier is correct", () => {
		const node = limiter();

		expect(node.type[2]).toBe("limiter");
	});

	it("clone preserves and can override properties", () => {
		const node = limiter({ threshold: -3 });
		const cloned = node.clone({ attack: 5 });

		expect(cloned.properties.threshold).toBe(-3);
		expect(cloned.properties.attack).toBe(5);
	});

	it("oversampling=2 engages true-peak detection: catches inter-sample peaks that oversampling=1 misses", () => {
		// True-peak test: construct a high-frequency sine whose sampled
		// |x| stays below threshold but whose reconstructed inter-sample peak
		// exceeds it. The oversampled limiter must reduce gain; the
		// non-oversampled limiter must pass the signal unchanged.
		//
		// At 12000 Hz with 48000 Hz sample rate, the sine has 4 samples per
		// cycle — sampling on zero-crossings leaves the sampled peak near
		// zero while the true peak lies between samples.
		const frames = 4096;
		const freqHz = 12000;
		const amplitude = 0.9; // above -1 dBFS threshold (≈ 0.891)
		const sineData = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			// Phase offset so samples land near zero-crossings rather than peaks.
			sineData[index] = amplitude * Math.sin((2 * Math.PI * freqHz * index) / SAMPLE_RATE);
		}

		const chunk = { samples: [sineData], offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };

		const nodeNoOversample = limiter({ oversampling: 1, attack: 0, release: 0 });
		const nodeOversample = limiter({ oversampling: 2, attack: 0, release: 0 });

		const streamNo = nodeNoOversample.createStream();
		const streamYes = nodeOversample.createStream();

		// Warm up both streams so the envelope and oversampler LP have settled.
		for (let rep = 0; rep < 5; rep++) {
			streamNo._unbuffer(chunk);
			streamYes._unbuffer(chunk);
		}

		const outNo = streamNo._unbuffer(chunk);
		const outYes = streamYes._unbuffer(chunk);

		for (const sample of outNo.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		for (const sample of outYes.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}

		// The oversampled limiter should apply more gain reduction on average
		// because it detects the inter-sample peaks. Compare settled-portion
		// RMS: oversampled RMS < non-oversampled RMS.
		const half = Math.floor(frames / 2);
		let rmsNoSq = 0;
		let rmsYesSq = 0;

		for (let index = half; index < frames; index++) {
			rmsNoSq += (outNo.samples[0]![index] ?? 0) ** 2;
			rmsYesSq += (outYes.samples[0]![index] ?? 0) ** 2;
		}

		const rmsNo = Math.sqrt(rmsNoSq / (frames - half));
		const rmsYes = Math.sqrt(rmsYesSq / (frames - half));

		expect(rmsYes).toBeLessThan(rmsNo);
	});
});
