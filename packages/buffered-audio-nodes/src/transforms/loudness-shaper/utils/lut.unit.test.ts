import { describe, expect, it } from "vitest";
import { type CurveParams, f } from "./curve";
import { buildLUT, lookupLUT } from "./lut";

const baseParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	floor: 0.01,
	bodyLow: 0.1,
	bodyHigh: 0.5,
	peak: 0.8,
	...overrides,
});

describe("buildLUT / lookupLUT", () => {
	it("lookupLUT(lut, 0) returns 0", () => {
		const params = baseParams();
		const lut = buildLUT(params, params, 0.5, 256);

		expect(lookupLUT(lut, 0)).toBe(0);
	});

	it("|x| <= floor: lookup returns x (pass-through below floor)", () => {
		const params = baseParams({ floor: 0.05 });
		const lut = buildLUT(params, params, 1, 256);

		for (const x of [0.001, 0.01, 0.04, -0.001, -0.04]) {
			expect(lookupLUT(lut, x)).toBeCloseTo(x, 6);
		}
	});

	it("flat body: lookupLUT(lut, x) = x * (1 + boost) for bodyLow <= |x| <= bodyHigh", () => {
		const params = baseParams({ bodyLow: 0.1, bodyHigh: 0.5 });
		const boost = 0.7;
		const lut = buildLUT(params, params, boost, 256);

		for (const x of [0.1, 0.15, 0.2, 0.3, 0.4, 0.5]) {
			expect(lookupLUT(lut, x)).toBeCloseTo(x * (1 + boost), 5);
			expect(lookupLUT(lut, -x)).toBeCloseTo(-x * (1 + boost), 5);
		}
	});

	it("|x| >= peak (peak !== null): lookup returns x (pass-through above peak)", () => {
		const params = baseParams({ peak: 0.8 });
		const lut = buildLUT(params, params, 1, 256);

		for (const x of [0.8, 0.81, 0.95, 1, -0.8, -0.95]) {
			expect(lookupLUT(lut, x)).toBeCloseTo(x, 6);
		}

		// Above the LUT's tabulated upper limit, lookup also passes through
		// (handled by the `absX >= top` branch).
		expect(lookupLUT(lut, 1.2)).toBe(1.2);
		expect(lookupLUT(lut, -1.5)).toBe(-1.5);
	});

	it("matches analytic f(x) within 0.001 across 100 random sample points", () => {
		const params = baseParams({ bodyLow: 0.1, bodyHigh: 0.5, peak: 0.9 });
		const boost = 0.6;
		const lut = buildLUT(params, params, boost, 512);

		// Deterministic LCG so test is repeatable.
		let state = 0xDEAD_BEEF >>> 0;
		const next = (): number => {
			state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;

			return state / 0x1_00_00_00_00;
		};

		let maxError = 0;

		for (let index = 0; index < 100; index++) {
			const x = next() * 1.0; // [0, 1.0)
			const expected = f(x, boost, params, params);
			const actual = lookupLUT(lut, x);
			const error = Math.abs(actual - expected);

			if (error > maxError) maxError = error;
		}

		expect(maxError).toBeLessThan(0.001);
	});

	it("warmth = 0 (identical pos/neg params): lookupLUT(lut, -x) === -lookupLUT(lut, x)", () => {
		const params = baseParams();
		const lut = buildLUT(params, params, 0.6, 512);
		const xs = [0.005, 0.05, 0.1, 0.2, 0.4, 0.7, 0.78];

		for (const x of xs) {
			const positive = lookupLUT(lut, x);
			const negative = lookupLUT(lut, -x);

			expect(negative).toBe(-positive);
		}
	});

	it("preservePeaks = false (peak === null): no upper roll-off, body lift continues above bodyHigh", () => {
		const params = baseParams({ bodyLow: 0.1, bodyHigh: 0.5, peak: null });
		const boost = 0.5;
		const lut = buildLUT(params, params, boost, 256);

		// Body lift continues at full strength up to the LUT's upper limit (1.0).
		// Above bodyLow the shape is 1, so f(x) = x * (1 + boost).
		for (const x of [0.15, 0.3, 0.5, 0.6, 0.8, 0.99]) {
			expect(lookupLUT(lut, x)).toBeCloseTo(x * (1 + boost), 5);
		}
	});

	it("rejects pointCountTarget < 4", () => {
		const params = baseParams();

		expect(() => buildLUT(params, params, 0.5, 3)).toThrow();
		expect(() => buildLUT(params, params, 0.5, 0)).toThrow();
		expect(() => buildLUT(params, params, 0.5, 1.5)).toThrow();
	});

	it("warmth > 0: asymmetric pos/neg peak yields asymmetric LUT behaviour", () => {
		const pos: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.9 };
		const neg: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.6 };
		const lut = buildLUT(pos, neg, 1, 512);

		// At |x| = 0.7: positive ramp still active (peak = 0.9); negative
		// already past its peak (0.6) → pass-through.
		const pX = 0.7;
		const positive = lookupLUT(lut, pX);
		const negative = lookupLUT(lut, -pX);

		expect(negative).toBeCloseTo(-pX, 6); // pass-through
		expect(positive).toBeGreaterThan(pX); // boosted
		expect(negative).not.toBe(-positive);
	});
});
