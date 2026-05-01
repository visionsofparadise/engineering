import { describe, expect, it } from "vitest";
import { type CurveParams, f, shapeAt } from "./curve";

const symmetricParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	median: 0.1,
	max: 0.8,
	density: 1,
	warmth: 0,
	...overrides,
});

describe("shapeAt", () => {
	it("returns 0 at the lower anchor (absX = 0)", () => {
		const cases: Array<[number, number, number]> = [
			[0.1, 0.8, 1],
			[0.05, 0.5, 2],
			[0.2, 0.9, 0.5],
		];

		for (const [median, max, density] of cases) {
			expect(shapeAt(0, median, max, density)).toBe(0);
		}
	});

	it("returns 1 at the median peak (absX = median)", () => {
		const cases: Array<[number, number, number]> = [
			[0.1, 0.8, 1],
			[0.05, 0.5, 2],
			[0.2, 0.9, 5],
			[0.3, 0.7, 0.5],
		];

		for (const [median, max, density] of cases) {
			expect(shapeAt(median, median, max, density)).toBeCloseTo(1, 12);
		}
	});

	it("returns 0 at the upper anchor (absX = max)", () => {
		const cases: Array<[number, number, number]> = [
			[0.1, 0.8, 1],
			[0.05, 0.5, 2],
			[0.2, 0.9, 0.5],
		];

		for (const [median, max, density] of cases) {
			expect(shapeAt(max, median, max, density)).toBe(0);
		}
	});

	it("density = 1: shapeAt(median / 2) = 0.5 (linear ramp on rising side)", () => {
		const median = 0.2;
		const max = 0.8;

		expect(shapeAt(median / 2, median, max, 1)).toBeCloseTo(0.5, 12);
	});

	it("density = 1: shapeAt((median + max) / 2) = 0.5 (linear ramp on falling side)", () => {
		const median = 0.2;
		const max = 0.8;
		const midpoint = (median + max) / 2;

		expect(shapeAt(midpoint, median, max, 1)).toBeCloseTo(0.5, 12);
	});

	it("density = 5: shapeAt(median * 0.99) ~= 0.95 (sharp rise near median)", () => {
		const median = 0.1;
		const max = 0.8;
		const value = shapeAt(median * 0.99, median, max, 5);

		expect(value).toBeGreaterThan(0.945);
		expect(value).toBeLessThan(0.955);
	});

	it("returns 0 for absX > max (pass-through region)", () => {
		expect(shapeAt(1, 0.1, 0.8, 1)).toBe(0);
		expect(shapeAt(1.5, 0.1, 0.8, 2)).toBe(0);
	});
});

describe("f (signed transfer)", () => {
	it("warmth = 0: f(-x) === -f(x) exactly", () => {
		const params = symmetricParams({ density: 2 });
		const xs = [0.01, 0.05, 0.1, 0.2, 0.5, 0.79];
		const Bs = [0.1, 0.5, 1, 2];

		for (const B of Bs) {
			for (const x of xs) {
				const positive = f(x, B, params, params);
				const negative = f(-x, B, params, params);

				expect(negative).toBe(-positive);
			}
		}
	});

	it("B = 0 is identity", () => {
		const params = symmetricParams({ density: 3 });
		const xs = [-0.5, -0.1, 0, 0.05, 0.2, 0.7, 1.5];

		for (const x of xs) {
			expect(f(x, 0, params, params)).toBe(x);
		}
	});

	it("|x| >= max: pass-through (f(x) = x)", () => {
		const params = symmetricParams();

		expect(f(0.8, 1, params, params)).toBe(0.8);
		expect(f(0.81, 1, params, params)).toBe(0.81);
		expect(f(2, 5, params, params)).toBe(2);
		expect(f(-1.2, 0.5, params, params)).toBe(-1.2);
	});

	it("f(0) === 0 regardless of params", () => {
		expect(f(0, 5, symmetricParams(), symmetricParams())).toBe(0);
		expect(f(0, 0, symmetricParams({ density: 0.3 }), symmetricParams({ density: 0.3 }))).toBe(0);
	});

	it("f(median) = median * (1 + B) per design anchor", () => {
		const params = symmetricParams({ median: 0.1, max: 0.8, density: 2 });
		const B = 0.7;

		expect(f(0.1, B, params, params)).toBeCloseTo(0.1 * (1 + B), 12);
	});

	it("warmth > 0 with negParams = posParams behaves identically to warmth = 0", () => {
		const pos = symmetricParams({ density: 2, warmth: 0.5 });
		const posWarmthZero = symmetricParams({ density: 2, warmth: 0 });

		// At warmth blend with same params, shape collapses to a single value.
		const xs = [-0.5, -0.1, -0.05, 0, 0.05, 0.1, 0.5];

		for (const x of xs) {
			expect(f(x, 0.5, pos, pos)).toBe(f(x, 0.5, posWarmthZero, posWarmthZero));
		}
	});

	it("warmth > 0: positive side equals warmth = 0 positive side (warmth only affects negative side)", () => {
		const pos: CurveParams = { median: 0.1, max: 0.8, density: 2, warmth: 0 };
		const posWarm: CurveParams = { median: 0.1, max: 0.8, density: 2, warmth: 0.7 };
		const negDifferent: CurveParams = { median: 0.05, max: 0.6, density: 3, warmth: 0.7 };

		const xs = [0.01, 0.05, 0.1, 0.3, 0.7];

		for (const x of xs) {
			const ref = f(x, 1, pos, pos);
			const warm = f(x, 1, posWarm, negDifferent);

			expect(warm).toBe(ref);
		}
	});

	it("warmth > 0: negative side differs from warmth = 0 when negParams differ from posParams", () => {
		const pos: CurveParams = { median: 0.1, max: 0.8, density: 2, warmth: 1 };
		const neg: CurveParams = { median: 0.05, max: 0.6, density: 3, warmth: 1 };
		const posSym: CurveParams = { median: 0.1, max: 0.8, density: 2, warmth: 0 };

		const xs = [-0.03, -0.07, -0.2, -0.4];

		for (const x of xs) {
			const symmetric = f(x, 1, posSym, posSym);
			const asymmetric = f(x, 1, pos, neg);

			expect(asymmetric).not.toBe(symmetric);
		}
	});

	it("warmth = 0.5: negative side lerps shape between symmetric and asymmetric reference", () => {
		const pos: CurveParams = { median: 0.1, max: 0.8, density: 2, warmth: 0.5 };
		const neg: CurveParams = { median: 0.05, max: 0.6, density: 3, warmth: 0.5 };
		const posSym: CurveParams = { ...pos, warmth: 0 };
		const negSym: CurveParams = { ...neg, warmth: 0 };

		const x = -0.04;
		const B = 1;
		const symmetric = f(x, B, posSym, posSym);
		const fullyAsymmetric = f(x, B, negSym, negSym);
		const blended = f(x, B, pos, neg);

		// shape blends 0.5 between the two; absX is the same. So blended
		// equals the linear midpoint of the two references' values when
		// |x| is identical (the only thing that lerps is the shape term).
		const expected = (symmetric + fullyAsymmetric) / 2;

		expect(blended).toBeCloseTo(expected, 12);
	});
});
