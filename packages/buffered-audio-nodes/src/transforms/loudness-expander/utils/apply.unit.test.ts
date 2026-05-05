import { describe, expect, it } from "vitest";
import { applySmoothedGainChunk } from "./apply";

describe("applySmoothedGainChunk", () => {
	it("unity envelope (smoothedGain all 1) returns input bytes (mono)", () => {
		const channel = new Float32Array([0, 0.01, -0.05, 0.1, -0.2, 0.5, -0.78, 0.9]);
		const smoothedGain = new Float32Array(channel.length);

		smoothedGain.fill(1);

		const [output] = applySmoothedGainChunk({
			chunkSamples: [channel],
			smoothedGain,
			offset: 0,
		});

		expect(output).toBeDefined();
		expect(output?.length).toBe(channel.length);

		for (let index = 0; index < channel.length; index++) {
			expect(output?.[index]).toBeCloseTo(channel[index] ?? 0, 6);
		}
	});

	it("scalar 2× envelope doubles every sample (mono)", () => {
		const channel = new Float32Array([0.1, -0.25, 0.5, -0.75, 1]);
		const smoothedGain = new Float32Array(channel.length);

		smoothedGain.fill(2);

		const [output] = applySmoothedGainChunk({
			chunkSamples: [channel],
			smoothedGain,
			offset: 0,
		});

		for (let index = 0; index < channel.length; index++) {
			expect(output?.[index]).toBeCloseTo(2 * (channel[index] ?? 0), 6);
		}
	});

	it("scalar 2× envelope doubles every sample (stereo)", () => {
		const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
		const right = new Float32Array([-0.1, -0.2, -0.3, -0.4]);
		const smoothedGain = new Float32Array(left.length);

		smoothedGain.fill(2);

		const [outLeft, outRight] = applySmoothedGainChunk({
			chunkSamples: [left, right],
			smoothedGain,
			offset: 0,
		});

		for (let index = 0; index < left.length; index++) {
			expect(outLeft?.[index]).toBeCloseTo(2 * (left[index] ?? 0), 6);
			expect(outRight?.[index]).toBeCloseTo(2 * (right[index] ?? 0), 6);
		}
	});

	it("offset slices the envelope correctly", () => {
		// Envelope of length 8: [1, 2, 3, 4, 5, 6, 7, 8]
		// Chunk length 3 starting at offset 5, source [1, 1, 1]
		// Expected output [6, 7, 8] (envelope[5], envelope[6], envelope[7])
		const smoothedGain = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const source = new Float32Array([1, 1, 1]);

		const [output] = applySmoothedGainChunk({
			chunkSamples: [source],
			smoothedGain,
			offset: 5,
		});

		expect(output?.length).toBe(3);
		expect(output?.[0]).toBeCloseTo(6, 6);
		expect(output?.[1]).toBeCloseTo(7, 6);
		expect(output?.[2]).toBeCloseTo(8, 6);
	});

	it("linked semantics: both channels use the same envelope value at each frame index", () => {
		// Stereo [1, 1, 1] / [-1, -1, -1] × envelope [2, 2, 2]
		// Expected: [2, 2, 2] / [-2, -2, -2]
		const left = new Float32Array([1, 1, 1]);
		const right = new Float32Array([-1, -1, -1]);
		const smoothedGain = new Float32Array([2, 2, 2]);

		const [outLeft, outRight] = applySmoothedGainChunk({
			chunkSamples: [left, right],
			smoothedGain,
			offset: 0,
		});

		expect(outLeft?.length).toBe(3);
		expect(outRight?.length).toBe(3);

		for (let index = 0; index < 3; index++) {
			expect(outLeft?.[index]).toBeCloseTo(2, 6);
			expect(outRight?.[index]).toBeCloseTo(-2, 6);
		}
	});

	it("linked semantics: varying envelope is read once per frame and reused across channels", () => {
		// Envelope varies per frame. Both channels at frame i must scale by the same gain[i].
		const left = new Float32Array([1, 1, 1, 1]);
		const right = new Float32Array([2, 2, 2, 2]);
		const smoothedGain = new Float32Array([0.5, 1, 1.5, 2]);

		const [outLeft, outRight] = applySmoothedGainChunk({
			chunkSamples: [left, right],
			smoothedGain,
			offset: 0,
		});

		for (let index = 0; index < left.length; index++) {
			const gain = smoothedGain[index] ?? 0;

			expect(outLeft?.[index]).toBeCloseTo((left[index] ?? 0) * gain, 6);
			expect(outRight?.[index]).toBeCloseTo((right[index] ?? 0) * gain, 6);
		}
	});

	it("empty channels array produces empty output", () => {
		const smoothedGain = new Float32Array([1, 2, 3]);
		const result = applySmoothedGainChunk({
			chunkSamples: [],
			smoothedGain,
			offset: 0,
		});

		expect(result).toEqual([]);
	});

	it("zero-length chunk samples produce zero-length per-channel outputs", () => {
		const smoothedGain = new Float32Array([1, 2, 3]);
		const [outLeft, outRight] = applySmoothedGainChunk({
			chunkSamples: [new Float32Array(0), new Float32Array(0)],
			smoothedGain,
			offset: 0,
		});

		expect(outLeft).toBeInstanceOf(Float32Array);
		expect(outLeft?.length).toBe(0);
		expect(outRight).toBeInstanceOf(Float32Array);
		expect(outRight?.length).toBe(0);
	});

	it("output is freshly allocated (mutating output does not change input)", () => {
		const input = new Float32Array([0.1, 0.2, 0.3]);
		const inputSnapshot = Float32Array.from(input);
		const smoothedGain = new Float32Array([1, 1, 1]);

		const [output] = applySmoothedGainChunk({
			chunkSamples: [input],
			smoothedGain,
			offset: 0,
		});

		expect(output).toBeDefined();
		expect(output).not.toBe(input);

		if (output) output[0] = 999;

		for (let index = 0; index < input.length; index++) {
			expect(input[index]).toBe(inputSnapshot[index]);
		}
	});
});
