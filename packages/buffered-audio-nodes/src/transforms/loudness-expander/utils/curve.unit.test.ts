import { describe, expect, it } from "vitest";
import { type CurveParams, gRaw, shapeAt } from "./curve";

const baseParams = (overrides: Partial<CurveParams> = {}): CurveParams => ({
	floor: 0.01,
	pivot: 0.2,
	tension: 1,
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
		const curveParams = baseParams({ floor: 0.05, pivot: 0.2 });

		expect(shapeAt(0, curveParams)).toBe(0);
		expect(shapeAt(0.001, curveParams)).toBe(0);
		expect(shapeAt(0.04, curveParams)).toBe(0);
	});

	it("returns 0 at the floor anchor itself", () => {
		const curveParams = baseParams({ floor: 0.05, pivot: 0.2 });

		expect(shapeAt(0.05, curveParams)).toBe(0);
	});

	it("returns 1 at the pivot anchor (full boost begins)", () => {
		const curveParams = baseParams({ floor: 0.02, pivot: 0.2 });

		expect(shapeAt(0.2, curveParams)).toBe(1);
	});

	it("returns 1 above the pivot anchor (full-boost region)", () => {
		const curveParams = baseParams({ floor: 0.02, pivot: 0.2 });

		expect(shapeAt(0.21, curveParams)).toBe(1);
		expect(shapeAt(0.5, curveParams)).toBe(1);
		expect(shapeAt(1, curveParams)).toBe(1);
		expect(shapeAt(1.5, curveParams)).toBe(1);
	});

	it("C⁰ continuity: shape is continuous at floor and pivot", () => {
		const curveParams = baseParams({ floor: 0.02, pivot: 0.2 });
		const eps = 1e-7;

		// floor: shape just above ≈ tensionedRamp(eps/(pivot-floor), 1) ≈ 0 ≈ shape at (0)
		expect(shapeAt(curveParams.floor + eps, curveParams)).toBeCloseTo(shapeAt(curveParams.floor, curveParams), 5);

		// pivot: shape just below ramps to ~1; shape at = 1
		expect(shapeAt(curveParams.pivot - eps, curveParams)).toBeCloseTo(1, 5);
		expect(shapeAt(curveParams.pivot, curveParams)).toBe(1);
	});

	describe("tension = 1 (linear, default): floor → pivot ramp", () => {
		it("midpoint of [floor, pivot] maps to 0.5 (linear)", () => {
			const curveParams = baseParams({ floor: 0.02, pivot: 0.2, tension: 1 });
			const midpoint = (curveParams.floor + curveParams.pivot) / 2;

			expect(shapeAt(midpoint, curveParams)).toBeCloseTo(tensionedRamp(0.5, 1), 12);
			expect(shapeAt(midpoint, curveParams)).toBeCloseTo(0.5, 12);
		});

		it("quarter-point of [floor, pivot] maps to 0.25 (linear)", () => {
			const curveParams = baseParams({ floor: 0.02, pivot: 0.2, tension: 1 });
			const quarterPoint = curveParams.floor + 0.25 * (curveParams.pivot - curveParams.floor);

			expect(shapeAt(quarterPoint, curveParams)).toBeCloseTo(tensionedRamp(0.25, 1), 12);
			expect(shapeAt(quarterPoint, curveParams)).toBeCloseTo(0.25, 12);
		});
	});

	describe("tension > 1 (convex): floor → pivot ramp bows above the linear diagonal", () => {
		it("midpoint value is > 0.5 (convex bows above diagonal)", () => {
			const curveParams = baseParams({ floor: 0.02, pivot: 0.2, tension: 2 });
			const midpoint = (curveParams.floor + curveParams.pivot) / 2;

			expect(shapeAt(midpoint, curveParams)).toBeGreaterThan(0.5);
			expect(shapeAt(midpoint, curveParams)).toBeCloseTo(tensionedRamp(0.5, 2), 12);
		});
	});

	describe("tension < 1 (concave): floor → pivot ramp bows below the linear diagonal", () => {
		it("midpoint value is < 0.5 (concave bows below diagonal)", () => {
			const curveParams = baseParams({ floor: 0.02, pivot: 0.2, tension: 0.5 });
			const midpoint = (curveParams.floor + curveParams.pivot) / 2;

			expect(shapeAt(midpoint, curveParams)).toBeLessThan(0.5);
			expect(shapeAt(midpoint, curveParams)).toBeCloseTo(tensionedRamp(0.5, 0.5), 12);
		});
	});

	it("degenerate: pivot === floor returns 0 everywhere", () => {
		const curveParams: CurveParams = { floor: 0.1, pivot: 0.1, tension: 1 };

		for (const probe of [0, 0.05, 0.1, 0.2, 0.5, 1]) {
			expect(shapeAt(probe, curveParams)).toBe(0);
		}
	});

	it("degenerate: pivot < floor (inverted) returns 0 everywhere", () => {
		const curveParams: CurveParams = { floor: 0.2, pivot: 0.1, tension: 1 };

		for (const probe of [0, 0.05, 0.15, 0.3, 0.5]) {
			expect(shapeAt(probe, curveParams)).toBe(0);
		}
	});
});

describe("gRaw (raw gain multiplier)", () => {
	it("boost = 0 returns 1 everywhere (no lift)", () => {
		const curveParams = baseParams();

		for (const absX of [0, 0.005, 0.05, 0.1, 0.2, 0.5, 1, 1.5]) {
			expect(gRaw(absX, 0, curveParams)).toBe(1);
		}
	});

	it("boost = 0.5 at absX === pivot returns 1.5 (full boost)", () => {
		const curveParams = baseParams({ floor: 0.02, pivot: 0.2 });

		expect(gRaw(0.2, 0.5, curveParams)).toBe(1.5);
	});

	it("boost = 1.0 at absX < floor returns 1 (pass-through)", () => {
		const curveParams = baseParams({ floor: 0.05, pivot: 0.2 });

		for (const absX of [0, 0.001, 0.01, 0.04]) {
			expect(gRaw(absX, 1, curveParams)).toBe(1);
		}
	});

	it("boost = 1.0 at absX === floor returns 1 (pass-through at the anchor)", () => {
		const curveParams = baseParams({ floor: 0.05, pivot: 0.2 });

		expect(gRaw(0.05, 1, curveParams)).toBe(1);
	});

	it("boost = 1.0 at absX >= pivot returns 1 + boost = 2 (full boost)", () => {
		const curveParams = baseParams({ floor: 0.02, pivot: 0.2 });

		for (const absX of [0.2, 0.21, 0.5, 1, 1.5]) {
			expect(gRaw(absX, 1, curveParams)).toBe(2);
		}
	});

	it("boost = 1.0 at midpoint of [floor, pivot] (linear tension) returns 1 + 0.5 = 1.5", () => {
		const curveParams = baseParams({ floor: 0.02, pivot: 0.2, tension: 1 });
		const midpoint = (curveParams.floor + curveParams.pivot) / 2;

		expect(gRaw(midpoint, 1, curveParams)).toBeCloseTo(1.5, 12);
	});

	it("degenerate pivot === floor: gRaw returns 1 everywhere regardless of boost", () => {
		const curveParams: CurveParams = { floor: 0.1, pivot: 0.1, tension: 1 };

		for (const absX of [0, 0.05, 0.1, 0.2, 0.5]) {
			expect(gRaw(absX, 1, curveParams)).toBe(1);
			expect(gRaw(absX, 5, curveParams)).toBe(1);
		}
	});
});
