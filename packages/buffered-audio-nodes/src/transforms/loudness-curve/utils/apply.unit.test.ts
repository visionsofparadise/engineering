import { describe, expect, it } from "vitest";
import { applyLUTBaseRate } from "./apply";
import { type CurveParams } from "./curve";
import { buildLUT, lookupLUT } from "./lut";

const symmetricParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	median: 0.1,
	max: 0.8,
	density: 1,
	warmth: 0,
	...overrides,
});

describe("applyLUTBaseRate", () => {
	it("identity LUT (boost = 0): output equals input within float epsilon", () => {
		const params = symmetricParams({ density: 2 });
		const lut = buildLUT(params, params, 0, 256);
		const channel = new Float32Array([0, 0.01, 0.05, -0.07, 0.1, -0.2, 0.5, -0.78, 0.9, -1.1]);

		const [output] = applyLUTBaseRate([channel], lut);

		expect(output).toBeDefined();
		expect(output?.length).toBe(channel.length);

		for (let index = 0; index < channel.length; index++) {
			// boost = 0 produces f(x) = x for |x| < max, and pass-through for
			// |x| >= max → both branches yield input unchanged.
			expect(output?.[index]).toBeCloseTo(channel[index] ?? 0, 6);
		}
	});

	it("each output sample equals Float32(lookupLUT(lut, input sample))", () => {
		const params = symmetricParams({ density: 2 });
		const lut = buildLUT(params, params, 0.7, 256);
		const channel = new Float32Array([0.02, 0.08, -0.12, 0.3, -0.6]);

		const [output] = applyLUTBaseRate([channel], lut);

		// `applyLUTBaseRate` writes into a Float32Array, so compare against
		// the float32-rounded lookup result rather than the f64 number.
		const f32Expected = new Float32Array(channel.length);

		for (let index = 0; index < channel.length; index++) {
			f32Expected[index] = lookupLUT(lut, channel[index] ?? 0);
		}

		for (let index = 0; index < channel.length; index++) {
			expect(output?.[index]).toBe(f32Expected[index]);
		}
	});

	it("multi-channel: each channel processed independently (no leakage)", () => {
		const params = symmetricParams({ density: 2 });
		const lut = buildLUT(params, params, 0.5, 256);
		const left = new Float32Array([0.05, 0.1, 0.2]);
		const right = new Float32Array([-0.05, -0.1, -0.2]);

		const [outLeft, outRight] = applyLUTBaseRate([left, right], lut);

		// At warmth = 0 the LUT is symmetric — outRight should be -outLeft.
		expect(outLeft?.length).toBe(3);
		expect(outRight?.length).toBe(3);

		for (let index = 0; index < 3; index++) {
			expect(outRight?.[index]).toBe(-(outLeft?.[index] ?? 0));
		}
	});

	it("empty input arrays produce empty output arrays", () => {
		const params = symmetricParams();
		const lut = buildLUT(params, params, 0.5, 256);

		expect(applyLUTBaseRate([], lut)).toEqual([]);

		const [output] = applyLUTBaseRate([new Float32Array(0)], lut);

		expect(output).toBeInstanceOf(Float32Array);
		expect(output?.length).toBe(0);
	});

	it("output is freshly allocated (mutating output does not change input)", () => {
		const params = symmetricParams();
		const lut = buildLUT(params, params, 0.5, 256);
		const input = new Float32Array([0.05, 0.1, 0.2]);
		const inputSnapshot = Float32Array.from(input);

		const [output] = applyLUTBaseRate([input], lut);

		expect(output).toBeDefined();
		expect(output).not.toBe(input);

		// Mutate output; input must remain unchanged.
		if (output) output[0] = 999;

		for (let index = 0; index < input.length; index++) {
			expect(input[index]).toBe(inputSnapshot[index]);
		}
	});
});
