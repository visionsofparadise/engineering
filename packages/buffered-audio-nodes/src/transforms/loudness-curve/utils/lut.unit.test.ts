import { describe, expect, it } from "vitest";
import { type CurveParams, f } from "./curve";
import { buildLUT, lookupLUT } from "./lut";

const symmetricParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	median: 0.1,
	max: 0.8,
	density: 1,
	warmth: 0,
	...overrides,
});

describe("buildLUT / lookupLUT", () => {
	it("lookup at exact sample points returns the analytic f(x) within float epsilon", () => {
		const params = symmetricParams({ density: 2 });
		const B = 0.5;
		const lut = buildLUT(params, params, B, 256);

		for (let index = 0; index < lut.posKeys.length; index++) {
			const key = lut.posKeys[index];

			if (key === undefined) continue;

			const expected = f(key, B, params, params);

			expect(lookupLUT(lut, key)).toBeCloseTo(expected, 6);
		}
	});

	it("lookup between sample points stays within 0.001 of analytic f(x)", () => {
		const params = symmetricParams({ density: 2 });
		const B = 0.7;
		const lut = buildLUT(params, params, B, 512);

		// Sample mid-points between adjacent keys to maximize linear-
		// interpolation error.
		let maxError = 0;

		for (let index = 0; index < lut.posKeys.length - 1; index++) {
			const lower = lut.posKeys[index];
			const upper = lut.posKeys[index + 1];

			if (lower === undefined || upper === undefined) continue;

			const x = (lower + upper) / 2;
			const expected = f(x, B, params, params);
			const actual = lookupLUT(lut, x);
			const error = Math.abs(actual - expected);

			if (error > maxError) maxError = error;
		}

		expect(maxError).toBeLessThan(0.001);
	});

	it("lookupLUT(lut, max + 0.1) returns max + 0.1 (pass-through above range)", () => {
		const params = symmetricParams();
		const lut = buildLUT(params, params, 1, 256);
		const probe = params.max + 0.1;

		expect(lookupLUT(lut, probe)).toBe(probe);
		expect(lookupLUT(lut, -probe)).toBe(-probe);
	});

	it("lookupLUT(lut, 0) returns 0", () => {
		const params = symmetricParams();
		const lut = buildLUT(params, params, 0.5, 256);

		expect(lookupLUT(lut, 0)).toBe(0);
	});

	it("warmth = 0: lookupLUT(lut, -x) === -lookupLUT(lut, x) (symmetry through LUT)", () => {
		const params = symmetricParams({ density: 2 });
		const lut = buildLUT(params, params, 0.6, 512);
		const xs = [0.005, 0.05, 0.1, 0.2, 0.4, 0.78];

		for (const x of xs) {
			const positive = lookupLUT(lut, x);
			const negative = lookupLUT(lut, -x);

			expect(negative).toBe(-positive);
		}
	});

	it("warmth > 0: asymmetric pos/neg params yield asymmetric LUT behaviour", () => {
		const pos: CurveParams = { median: 0.1, max: 0.8, density: 2, warmth: 1 };
		const neg: CurveParams = { median: 0.05, max: 0.6, density: 3, warmth: 1 };
		const lut = buildLUT(pos, neg, 1, 512);
		const xs = [0.03, 0.07, 0.2, 0.4];

		for (const x of xs) {
			const positive = lookupLUT(lut, x);
			const negative = lookupLUT(lut, -x);

			expect(negative).not.toBe(-positive);
		}
	});

	it("LUT key count is roughly pointCountTarget (within a factor of 2)", () => {
		const params = symmetricParams();
		const target = 512;
		const lut = buildLUT(params, params, 0.5, target);

		expect(lut.posKeys.length).toBeGreaterThanOrEqual(target / 2);
		expect(lut.posKeys.length).toBeLessThanOrEqual(target * 2);
		expect(lut.negKeys.length).toBeGreaterThanOrEqual(target / 2);
		expect(lut.negKeys.length).toBeLessThanOrEqual(target * 2);
	});

	it("rejects pointCountTarget < 4", () => {
		const params = symmetricParams();

		expect(() => buildLUT(params, params, 0.5, 3)).toThrow();
		expect(() => buildLUT(params, params, 0.5, 0)).toThrow();
		expect(() => buildLUT(params, params, 0.5, 1.5)).toThrow();
	});

	it("round-trip: dense sample of |x| ∈ [0, max] matches direct f within 0.001", () => {
		const cases: Array<{ density: number; B: number }> = [
			{ density: 0.5, B: 0.5 },
			{ density: 1, B: 1 },
			{ density: 2, B: 1.5 },
			{ density: 5, B: 2 },
		];

		for (const { density, B } of cases) {
			const params = symmetricParams({ density });
			const lut = buildLUT(params, params, B, 512);
			const samples = 10_000;
			let maxError = 0;

			for (let index = 0; index <= samples; index++) {
				const x = (index / samples) * params.max;
				const expected = f(x, B, params, params);
				const actual = lookupLUT(lut, x);
				const error = Math.abs(actual - expected);

				if (error > maxError) maxError = error;
			}

			expect(maxError, `density=${String(density)}, B=${String(B)}`).toBeLessThan(0.001);
		}
	});
});
