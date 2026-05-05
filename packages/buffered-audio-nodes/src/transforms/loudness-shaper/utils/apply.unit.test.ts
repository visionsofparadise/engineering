import { describe, expect, it } from "vitest";
import { applyCurveBaseRateChunk } from "./apply";
import { type CurveParams, f } from "./curve";

const symmetricParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	floor: 0.01,
	bodyLow: 0.05,
	bodyHigh: 0.4,
	peak: 0.8,
	tensionLow: 1,
	tensionHigh: 1,
	...overrides,
});

describe("applyCurveBaseRateChunk", () => {
	it("boost = 0: output equals input within float epsilon (curve is identity at boost = 0)", () => {
		const channel = new Float32Array([0, 0.01, 0.05, -0.07, 0.1, -0.2, 0.5, -0.78, 0.9, -1.1]);
		const params = symmetricParams();

		const [output] = applyCurveBaseRateChunk({
			chunkSamples: [channel],
			boost: 0,
			posParams: params,
			negParams: params,
		});

		expect(output).toBeDefined();
		expect(output?.length).toBe(channel.length);

		for (let index = 0; index < channel.length; index++) {
			expect(output?.[index]).toBeCloseTo(channel[index] ?? 0, 6);
		}
	});

	it("per-sample evaluation: output[i] = f(input[i], boost, posParams, negParams)", () => {
		const channel = new Float32Array([0.1, -0.1, 0.2, -0.2, 0.5, -0.5]);
		const params = symmetricParams();
		const boost = 0.5;

		const [output] = applyCurveBaseRateChunk({
			chunkSamples: [channel],
			boost,
			posParams: params,
			negParams: params,
		});

		for (let index = 0; index < channel.length; index++) {
			const expected = f(channel[index] ?? 0, boost, params, params);

			expect(output?.[index]).toBeCloseTo(expected, 6);
		}
	});

	it("warmth > 0 (sides differ in peak): pos vs neg samples evaluate against their own params", () => {
		const channel = new Float32Array([0.3, -0.3]);
		const posParams = symmetricParams({ peak: 0.5 });
		const negParams = symmetricParams({ peak: 0.7 });
		const boost = 0.5;

		const [output] = applyCurveBaseRateChunk({
			chunkSamples: [channel],
			boost,
			posParams,
			negParams,
		});

		expect(output?.[0]).toBeCloseTo(f(0.3, boost, posParams, negParams), 6);
		expect(output?.[1]).toBeCloseTo(f(-0.3, boost, posParams, negParams), 6);
	});

	it("multi-channel: per-channel sample sign drives per-side params lookup independently", () => {
		const left = new Float32Array([0.1, -0.1, 0.2]);
		const right = new Float32Array([-0.1, 0.1, -0.2]);
		const posParams = symmetricParams({ peak: 0.5 });
		const negParams = symmetricParams({ peak: 0.7 });
		const boost = 0.5;

		const [outLeft, outRight] = applyCurveBaseRateChunk({
			chunkSamples: [left, right],
			boost,
			posParams,
			negParams,
		});

		for (let index = 0; index < left.length; index++) {
			expect(outLeft?.[index]).toBeCloseTo(f(left[index] ?? 0, boost, posParams, negParams), 6);
			expect(outRight?.[index]).toBeCloseTo(f(right[index] ?? 0, boost, posParams, negParams), 6);
		}
	});

	it("symmetric mirrored stereo (right = -left): outRight === -outLeft sample-for-sample (per-channel processing)", () => {
		// Per design-loudness-shaper §"Pipeline shape": per-channel
		// processing, no linked detection. With posParams === negParams
		// the curve is sign-anti-symmetric (`f(-x) = -f(x)`); applying it
		// independently to mirrored channels produces strictly mirrored
		// outputs.
		const length = 32;
		const left = new Float32Array(length);
		const right = new Float32Array(length);

		for (let index = 0; index < length; index++) {
			left[index] = 0.1 * Math.sin((2 * Math.PI * index) / length);
			right[index] = -(left[index] ?? 0);
		}

		const params = symmetricParams();
		const boost = 0.5;

		const [outLeft, outRight] = applyCurveBaseRateChunk({
			chunkSamples: [left, right],
			boost,
			posParams: params,
			negParams: params,
		});

		for (let index = 0; index < length; index++) {
			expect(outRight?.[index]).toBeCloseTo(-(outLeft?.[index] ?? 0), 6);
		}
	});

	it("empty input arrays produce empty output arrays", () => {
		const params = symmetricParams();
		const empty = applyCurveBaseRateChunk({
			chunkSamples: [],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		expect(empty).toEqual([]);

		const [single] = applyCurveBaseRateChunk({
			chunkSamples: [new Float32Array(0)],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		expect(single).toBeInstanceOf(Float32Array);
		expect(single?.length).toBe(0);
	});

	it("output is freshly allocated (mutating output does not change input)", () => {
		const input = new Float32Array([0.05, 0.1, 0.2]);
		const inputSnapshot = Float32Array.from(input);
		const params = symmetricParams();

		const [output] = applyCurveBaseRateChunk({
			chunkSamples: [input],
			boost: 0.5,
			posParams: params,
			negParams: params,
		});

		expect(output).toBeDefined();
		expect(output).not.toBe(input);

		if (output) output[0] = 999;

		for (let index = 0; index < input.length; index++) {
			expect(input[index]).toBe(inputSnapshot[index]);
		}
	});
});
