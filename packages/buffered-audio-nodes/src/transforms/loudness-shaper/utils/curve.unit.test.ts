import { describe, expect, it } from "vitest";
import { type CurveParams, f, shapeAt } from "./curve";

const baseParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	floor: 0.01,
	bodyLow: 0.1,
	bodyHigh: 0.5,
	peak: 0.8,
	...overrides,
});

function smootherstep(unit: number): number {
	return unit * unit * unit * (unit * (unit * 6 - 15) + 10);
}

describe("shapeAt", () => {
	it("returns 0 below the floor anchor (pass-through region)", () => {
		const params = baseParams({ floor: 0.05 });

		expect(shapeAt(0, params)).toBe(0);
		expect(shapeAt(0.001, params)).toBe(0);
		expect(shapeAt(0.04, params)).toBe(0);
	});

	it("returns 0 at the floor anchor itself", () => {
		const params = baseParams({ floor: 0.05 });

		expect(shapeAt(0.05, params)).toBe(0);
	});

	it("ramps via smootherstep across [floor, bodyLow] — midpoint = smootherstep(0.5) = 0.5", () => {
		const params = baseParams({ floor: 0.02, bodyLow: 0.2 });
		const midpoint = (params.floor + params.bodyLow) / 2;

		expect(shapeAt(midpoint, params)).toBeCloseTo(smootherstep(0.5), 12);
		expect(shapeAt(midpoint, params)).toBeCloseTo(0.5, 12);
	});

	it("returns 1 at bodyLow (full boost begins)", () => {
		const params = baseParams({ bodyLow: 0.1 });

		expect(shapeAt(0.1, params)).toBeCloseTo(1, 12);
	});

	it("returns 1 at bodyHigh (full boost ends)", () => {
		const params = baseParams({ bodyHigh: 0.5 });

		expect(shapeAt(0.5, params)).toBeCloseTo(1, 12);
	});

	it("returns 1 throughout the flat body region [bodyLow, bodyHigh]", () => {
		const params = baseParams({ bodyLow: 0.1, bodyHigh: 0.5 });

		for (const probe of [0.1, 0.15, 0.2, 0.3, 0.4, 0.49, 0.5]) {
			expect(shapeAt(probe, params)).toBeCloseTo(1, 12);
		}
	});

	it("ramps via smootherstep across [bodyHigh, peak] — midpoint = smootherstep(0.5) = 0.5 (preservePeaks)", () => {
		const params = baseParams({ bodyHigh: 0.4, peak: 0.8 });
		const midpoint = (params.bodyHigh + (params.peak ?? 0)) / 2;

		expect(shapeAt(midpoint, params)).toBeCloseTo(smootherstep(0.5), 12);
		expect(shapeAt(midpoint, params)).toBeCloseTo(0.5, 12);
	});

	it("returns 0 at the peak anchor (preservePeaks)", () => {
		const params = baseParams({ peak: 0.8 });

		expect(shapeAt(0.8, params)).toBe(0);
	});

	it("returns 0 above the peak anchor (pass-through region, preservePeaks)", () => {
		const params = baseParams({ peak: 0.8 });

		expect(shapeAt(0.81, params)).toBe(0);
		expect(shapeAt(1, params)).toBe(0);
		expect(shapeAt(1.5, params)).toBe(0);
	});

	it("returns 1 above bodyHigh when peak === null (preservePeaks = false)", () => {
		const params = baseParams({ bodyHigh: 0.5, peak: null });

		expect(shapeAt(0.5, params)).toBeCloseTo(1, 12);
		expect(shapeAt(0.6, params)).toBe(1);
		expect(shapeAt(0.9, params)).toBe(1);
		expect(shapeAt(1.5, params)).toBe(1);
	});

	it("degenerate: bodyLow <= floor returns 0 everywhere", () => {
		const params: CurveParams = { floor: 0.1, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.8 };

		for (const probe of [0, 0.05, 0.1, 0.2, 0.5, 0.8, 1]) {
			expect(shapeAt(probe, params)).toBe(0);
		}

		const inverted: CurveParams = { floor: 0.2, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.8 };

		expect(shapeAt(0.3, inverted)).toBe(0);
	});

	it("degenerate: peak !== null && peak <= bodyHigh returns 0 everywhere", () => {
		const params: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.5 };

		for (const probe of [0, 0.05, 0.2, 0.4, 0.6]) {
			expect(shapeAt(probe, params)).toBe(0);
		}

		const inverted: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.4 };

		expect(shapeAt(0.45, inverted)).toBe(0);
	});

	it("smoothness: zero finite-difference slope at floor, bodyLow, bodyHigh, peak (smootherstep C² endpoints)", () => {
		const params = baseParams({ floor: 0.02, bodyLow: 0.2, bodyHigh: 0.5, peak: 0.8 });
		const eps = 1e-5;

		// At each anchor the smootherstep ramp endpoint has zero slope.
		for (const anchor of [params.floor, params.bodyLow, params.bodyHigh, params.peak ?? 0]) {
			const justBelow = shapeAt(anchor - eps, params);
			const justAbove = shapeAt(anchor + eps, params);
			const slope = (justAbove - justBelow) / (2 * eps);

			expect(Math.abs(slope)).toBeLessThan(1e-3);
		}
	});
});

describe("f (signed transfer)", () => {
	it("strict symmetry when posParams === negParams: f(-x) = -f(x)", () => {
		const params = baseParams();
		const xs = [0.005, 0.05, 0.1, 0.2, 0.5, 0.7, 0.79];
		const boosts = [0.1, 0.5, 1, 2];

		for (const boost of boosts) {
			for (const x of xs) {
				const positive = f(x, boost, params, params);
				const negative = f(-x, boost, params, params);

				expect(negative).toBe(-positive);
			}
		}
	});

	it("boost = 0 is identity", () => {
		const params = baseParams();
		const xs = [-0.5, -0.1, 0, 0.05, 0.2, 0.7, 1.5];

		for (const x of xs) {
			expect(f(x, 0, params, params)).toBe(x);
		}
	});

	it("flat body: f(x) = x * (1 + boost) for bodyLow <= |x| <= bodyHigh", () => {
		const params = baseParams({ bodyLow: 0.1, bodyHigh: 0.5 });
		const boost = 0.7;

		for (const x of [0.1, 0.2, 0.3, 0.4, 0.5]) {
			expect(f(x, boost, params, params)).toBeCloseTo(x * (1 + boost), 12);
			expect(f(-x, boost, params, params)).toBeCloseTo(-x * (1 + boost), 12);
		}
	});

	it("|x| <= floor: pass-through (f(x) = x)", () => {
		const params = baseParams({ floor: 0.05 });
		const boost = 1;

		for (const x of [0, 0.001, 0.01, 0.04, 0.05, -0.001, -0.02, -0.049]) {
			expect(f(x, boost, params, params)).toBe(x);
		}
	});

	it("|x| >= peak (peak !== null): pass-through (f(x) = x)", () => {
		const params = baseParams({ peak: 0.8 });
		const boost = 1;

		for (const x of [0.8, 0.81, 1, 1.5, -0.8, -1.2]) {
			expect(f(x, boost, params, params)).toBe(x);
		}
	});

	it("f(0) === 0 regardless of params", () => {
		expect(f(0, 5, baseParams(), baseParams())).toBe(0);
		expect(f(0, 0, baseParams({ peak: null }), baseParams({ peak: null }))).toBe(0);
	});

	it("asymmetry: pos/neg params with different peak yields different shape on the negative-side ramp", () => {
		const pos: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.8 };
		const neg: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.6 };
		const boost = 1;

		// At |x| = 0.7: positive side shape ramps within [0.5, 0.8] (still in
		// the ramp); negative side at |x| = 0.7 is above peak = 0.6 → pass-
		// through. So f(0.7) gets boosted, f(-0.7) does not.
		const positive = f(0.7, boost, pos, neg);
		const negative = f(-0.7, boost, pos, neg);

		expect(positive).not.toBe(-negative);
		expect(negative).toBe(-0.7); // pass-through
		expect(positive).toBeGreaterThan(0.7); // boosted
	});
});
