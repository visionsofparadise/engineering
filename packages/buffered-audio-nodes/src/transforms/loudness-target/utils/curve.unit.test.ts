import { describe, expect, it } from "vitest";
import { type Anchors, gainDbAt } from "./curve";

const baseAnchors = (overrides: Partial<Anchors> = {}): Anchors => ({
	floorDb: -55,
	pivotDb: -30,
	limitDb: -3,
	B: 6,
	peakGainDb: 2,
	...overrides,
});

describe("gainDbAt", () => {
	it("returns 0 below the floor anchor (pass-through region)", () => {
		const anchors = baseAnchors();

		expect(gainDbAt(-100, anchors)).toBe(0);
	});

	it("returns B at the pivot anchor (full body gain)", () => {
		const anchors = baseAnchors({ B: 6 });

		expect(gainDbAt(-30, anchors)).toBeCloseTo(6, 12);
	});

	it("returns peakGainDb at the limit anchor", () => {
		const anchors = baseAnchors({ peakGainDb: 2 });

		expect(gainDbAt(-3, anchors)).toBeCloseTo(2, 12);
	});

	it("linear midpoint of the pivot→limit segment", () => {
		const anchors = baseAnchors({ pivotDb: -30, limitDb: -3, B: 6, peakGainDb: 2 });
		// absXDb = -15: t = (-15 - -30) / (-3 - -30) = 15 / 27 ≈ 0.5556
		// result = 6 + (2 - 6) * 0.5556 ≈ 3.7778
		const t = (-15 - -30) / (-3 - -30);
		const expected = 6 + (2 - 6) * t;

		expect(gainDbAt(-15, anchors)).toBeCloseTo(expected, 12);
		expect(gainDbAt(-15, anchors)).toBeCloseTo(3.7778, 3);
	});

	it("returns B everywhere below pivot when floorDb is null (uniform body gain)", () => {
		const anchors = baseAnchors({ floorDb: null, B: 6 });

		for (const probe of [-100, -80, -60, -40, -31]) {
			expect(gainDbAt(probe, anchors)).toBe(6);
		}
	});

	it("monotonic non-decreasing across an ascending pivot→limit segment", () => {
		// peakGainDb > B → ascending segment.
		const anchors = baseAnchors({ B: 2, peakGainDb: 9, pivotDb: -30, limitDb: -3 });

		let prev = -Infinity;

		for (let i = 0; i <= 50; i++) {
			const absXDb = -30 + (i / 50) * 27;
			const g = gainDbAt(absXDb, anchors);

			expect(g).toBeGreaterThanOrEqual(prev - 1e-12);
			prev = g;
		}
	});

	it("monotonic non-increasing across a descending pivot→limit segment (linear)", () => {
		// peakGainDb < B → descending segment. Linear → strictly monotone.
		const anchors = baseAnchors({ B: 6, peakGainDb: 2, pivotDb: -30, limitDb: -3 });

		let prev = Infinity;

		for (let i = 0; i <= 50; i++) {
			const absXDb = -30 + (i / 50) * 27;
			const g = gainDbAt(absXDb, anchors);

			expect(g).toBeLessThanOrEqual(prev + 1e-12);
			prev = g;
		}
	});

	it("C⁰ continuity at pivotDb (left and right limits agree to <= 1e-3 dB)", () => {
		const anchors = baseAnchors({ B: 6, peakGainDb: 2, pivotDb: -30, limitDb: -3, floorDb: -55 });
		const eps = 1e-6;

		const left = gainDbAt(-30 - eps, anchors);
		const right = gainDbAt(-30 + eps, anchors);

		expect(Math.abs(left - right)).toBeLessThanOrEqual(1e-3);
	});

	it("C⁰ continuity at limitDb (linear-segment value matches brick-wall value)", () => {
		// At absXDb = limitDb both branches must produce peakGainDb:
		//   linear branch:     B + 1·(peakGainDb − B) = peakGainDb
		//   brick-wall branch: limitDb + peakGainDb − limitDb = peakGainDb
		const anchors = baseAnchors({ B: 6, peakGainDb: 2, pivotDb: -30, limitDb: -3 });
		const eps = 1e-6;

		const left = gainDbAt(-3 - eps, anchors);
		const right = gainDbAt(-3 + eps, anchors);

		// `eps = 1e-6` shifts each side by ε on its own segment; precision
		// 5 (tolerance 5e-6) accommodates the linear/brick-wall slopes of
		// ±1 dB/dB at the boundary.
		expect(left).toBeCloseTo(2, 5);
		expect(right).toBeCloseTo(2, 5);
		expect(Math.abs(left - right)).toBeLessThanOrEqual(1e-3);
	});

	it("brick-wall above limitDb: gainDb decreases 1 dB per 1 dB of absXDb (clamps output at limitDb + peakGainDb)", () => {
		// gainDbAt(limitDb + delta) === peakGainDb − delta. The closed
		// form keeps apparent output (absXDb + gainDb) = limitDb +
		// peakGainDb = effectiveTargetTp.
		const anchors = baseAnchors({ B: 6, peakGainDb: 2, pivotDb: -30, limitDb: -3 });

		for (const delta of [0.1, 0.5, 1, 2, 5, 10]) {
			const absXDb = -3 + delta;
			const gainDb = gainDbAt(absXDb, anchors);

			expect(gainDb).toBeCloseTo(2 - delta, 12);
			expect(absXDb + gainDb).toBeCloseTo(-3 + 2, 12);
		}
	});

	it("brick-wall is continuous with the linear segment at limitDb (no step)", () => {
		// As absXDb sweeps through limitDb, gainDb passes smoothly from
		// the linear segment's terminal value `peakGainDb` to the brick
		// wall's `peakGainDb − ε` without a discontinuity.
		const anchors = baseAnchors({ B: 6, peakGainDb: -1, pivotDb: -30, limitDb: -10 });
		const samples = [-10.001, -10, -9.999, -9];
		const gains = samples.map((absXDb) => gainDbAt(absXDb, anchors));

		// Monotonic non-increasing across the boundary and beyond.
		for (let i = 1; i < gains.length; i++) {
			expect(gains[i] ?? 0).toBeLessThanOrEqual((gains[i - 1] ?? 0) + 1e-12);
		}

		// First sample (just under limitDb) lands almost exactly at peakGainDb.
		expect(gains[0]).toBeCloseTo(-1, 3);
		// Brick-wall sample at limitDb + 1 dB lands at peakGainDb − 1.
		expect(gains[3]).toBeCloseTo(-2, 12);
	});
});
