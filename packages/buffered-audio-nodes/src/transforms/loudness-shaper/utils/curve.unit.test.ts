import { describe, expect, it } from "vitest";
import { type CurveParams, f, shapeAt } from "./curve";

const baseParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	floor: 0.01,
	bodyLow: 0.1,
	bodyHigh: 0.5,
	peak: 0.8,
	tensionLow: 1,
	tensionHigh: 1,
	...overrides,
});

/**
 * Superellipse-family tensioned ramp — mirrors the implementation in
 * curve.ts for use as a test reference.
 */
function tensionedRamp(unit: number, tension: number): number {
	if (tension === 1) return unit;
	if (tension > 1) return Math.pow(1 - Math.pow(1 - unit, tension), 1 / tension);
	return 1 - Math.pow(1 - Math.pow(unit, 1 / tension), tension);
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

	it("C⁰ continuity: shape is continuous at all four anchors (floor, bodyLow, bodyHigh, peak)", () => {
		const params = baseParams({ floor: 0.02, bodyLow: 0.2, bodyHigh: 0.5, peak: 0.8 });
		const eps = 1e-7;

		// floor: shape just above = tensionedRamp(eps/(bodyLow-floor), 1) ≈ 0 ≈ shape just below (0)
		expect(shapeAt(params.floor + eps, params)).toBeCloseTo(shapeAt(params.floor, params), 5);

		// bodyLow: shape just below ramps to ~1; shape at = 1
		expect(shapeAt(params.bodyLow - eps, params)).toBeCloseTo(1, 5);
		expect(shapeAt(params.bodyLow, params)).toBeCloseTo(1, 12);

		// bodyHigh: shape at = 1; shape just above begins ramp down from 1
		expect(shapeAt(params.bodyHigh, params)).toBeCloseTo(1, 12);
		expect(shapeAt(params.bodyHigh + eps, params)).toBeCloseTo(1, 5);

		// peak: shape just below ramps to ~0; shape at = 0
		expect(shapeAt((params.peak ?? 0) - eps, params)).toBeCloseTo(0, 5);
		expect(shapeAt(params.peak ?? 0, params)).toBe(0);
	});

	describe("tensionLow = 1 (linear, default): floor → bodyLow ramp", () => {
		it("midpoint of [floor, bodyLow] maps to 0.5 (linear)", () => {
			const params = baseParams({ floor: 0.02, bodyLow: 0.2, tensionLow: 1 });
			const midpoint = (params.floor + params.bodyLow) / 2;

			expect(shapeAt(midpoint, params)).toBeCloseTo(tensionedRamp(0.5, 1), 12);
			expect(shapeAt(midpoint, params)).toBeCloseTo(0.5, 12);
		});

		it("quarter-point of [floor, bodyLow] maps to 0.25 (linear)", () => {
			const params = baseParams({ floor: 0.02, bodyLow: 0.2, tensionLow: 1 });
			const quarterPoint = params.floor + 0.25 * (params.bodyLow - params.floor);

			expect(shapeAt(quarterPoint, params)).toBeCloseTo(tensionedRamp(0.25, 1), 12);
			expect(shapeAt(quarterPoint, params)).toBeCloseTo(0.25, 12);
		});
	});

	describe("tensionLow > 1 (convex): floor → bodyLow ramp bows above the linear diagonal", () => {
		it("midpoint value is > 0.5 (convex bows above diagonal)", () => {
			const params = baseParams({ floor: 0.02, bodyLow: 0.2, tensionLow: 2 });
			const midpoint = (params.floor + params.bodyLow) / 2;

			expect(shapeAt(midpoint, params)).toBeGreaterThan(0.5);
			expect(shapeAt(midpoint, params)).toBeCloseTo(tensionedRamp(0.5, 2), 12);
		});
	});

	describe("tensionLow < 1 (concave): floor → bodyLow ramp bows below the linear diagonal", () => {
		it("midpoint value is < 0.5 (concave bows below diagonal)", () => {
			const params = baseParams({ floor: 0.02, bodyLow: 0.2, tensionLow: 0.5 });
			const midpoint = (params.floor + params.bodyLow) / 2;

			expect(shapeAt(midpoint, params)).toBeLessThan(0.5);
			expect(shapeAt(midpoint, params)).toBeCloseTo(tensionedRamp(0.5, 0.5), 12);
		});
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

	describe("tensionHigh = 1 (linear, default): bodyHigh → peak ramp", () => {
		it("midpoint of [bodyHigh, peak] maps to 0.5 (linear)", () => {
			const params = baseParams({ bodyHigh: 0.4, peak: 0.8, tensionHigh: 1 });
			const midpoint = (params.bodyHigh + (params.peak ?? 0)) / 2;

			expect(shapeAt(midpoint, params)).toBeCloseTo(tensionedRamp(0.5, 1), 12);
			expect(shapeAt(midpoint, params)).toBeCloseTo(0.5, 12);
		});
	});

	describe("tensionHigh > 1 (convex): bodyHigh → peak ramp bows above the linear diagonal", () => {
		it("midpoint value is > 0.5 (convex bows above diagonal; shape stays higher longer)", () => {
			const params = baseParams({ bodyHigh: 0.4, peak: 0.8, tensionHigh: 2 });
			const midpoint = (params.bodyHigh + (params.peak ?? 0)) / 2;

			// The ramp runs 1 → 0 (unit = (peak - absX) / (peak - bodyHigh)),
			// so at the spatial midpoint unit = 0.5 and tensionedRamp(0.5, 2) > 0.5.
			expect(shapeAt(midpoint, params)).toBeGreaterThan(0.5);
			expect(shapeAt(midpoint, params)).toBeCloseTo(tensionedRamp(0.5, 2), 12);
		});
	});

	describe("tensionHigh < 1 (concave): bodyHigh → peak ramp bows below the linear diagonal", () => {
		it("midpoint value is < 0.5 (concave bows below diagonal)", () => {
			const params = baseParams({ bodyHigh: 0.4, peak: 0.8, tensionHigh: 0.5 });
			const midpoint = (params.bodyHigh + (params.peak ?? 0)) / 2;

			expect(shapeAt(midpoint, params)).toBeLessThan(0.5);
			expect(shapeAt(midpoint, params)).toBeCloseTo(tensionedRamp(0.5, 0.5), 12);
		});
	});

	it("tensionHigh value has no effect when peak === null (preservePeaks = false)", () => {
		const paramsA = baseParams({ bodyHigh: 0.5, peak: null, tensionHigh: 1 });
		const paramsB = baseParams({ bodyHigh: 0.5, peak: null, tensionHigh: 2 });

		for (const absX of [0.51, 0.6, 0.8, 1.0, 1.5]) {
			expect(shapeAt(absX, paramsA)).toBe(shapeAt(absX, paramsB));
			expect(shapeAt(absX, paramsA)).toBe(1);
		}
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
		const params: CurveParams = { floor: 0.1, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.8, tensionLow: 1, tensionHigh: 1 };

		for (const probe of [0, 0.05, 0.1, 0.2, 0.5, 0.8, 1]) {
			expect(shapeAt(probe, params)).toBe(0);
		}

		const inverted: CurveParams = { floor: 0.2, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.8, tensionLow: 1, tensionHigh: 1 };

		expect(shapeAt(0.3, inverted)).toBe(0);
	});

	it("degenerate: peak !== null && peak <= bodyHigh returns 0 everywhere", () => {
		const params: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.5, tensionLow: 1, tensionHigh: 1 };

		for (const probe of [0, 0.05, 0.2, 0.4, 0.6]) {
			expect(shapeAt(probe, params)).toBe(0);
		}

		const inverted: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.4, tensionLow: 1, tensionHigh: 1 };

		expect(shapeAt(0.45, inverted)).toBe(0);
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
		const pos: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.8, tensionLow: 1, tensionHigh: 1 };
		const neg: CurveParams = { floor: 0.01, bodyLow: 0.1, bodyHigh: 0.5, peak: 0.6, tensionLow: 1, tensionHigh: 1 };
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
