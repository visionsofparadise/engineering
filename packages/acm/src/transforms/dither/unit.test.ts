import { describe, it, expect } from "vitest";
import { DitherTransformModule, dither } from ".";

describe("DitherTransformModule", () => {
	it("quantizes samples to 16-bit grid", () => {
		const unit = dither(16);
		const levels = Math.pow(2, 15);
		const input = new Float32Array([0.12345678, -0.98765432, 0, 0.5]);

		const result = unit._unbuffer({
			samples: [input],
			offset: 0,
			duration: input.length,
		});

		for (const sample of result.samples[0]!) {
			const scaled = Math.round(sample * levels);
			const snapped = scaled / levels;
			expect(Math.abs(sample - snapped)).toBeLessThan(1e-10);
		}
	});

	it("quantizes samples to 24-bit grid", () => {
		const unit = dither(24);
		const levels = Math.pow(2, 23);
		const input = new Float32Array([0.12345678, -0.98765432]);

		const result = unit._unbuffer({
			samples: [input],
			offset: 0,
			duration: input.length,
		});

		for (const sample of result.samples[0]!) {
			const scaled = Math.round(sample * levels);
			const snapped = scaled / levels;
			expect(Math.abs(sample - snapped)).toBeLessThan(1e-10);
		}
	});

	it("preserves silence", () => {
		const unit = dither(16);
		const input = new Float32Array(100).fill(0);

		const result = unit._unbuffer({
			samples: [input],
			offset: 0,
			duration: input.length,
		});

		for (const sample of result.samples[0]!) {
			expect(Math.abs(sample)).toBeLessThan(0.001);
		}
	});
});
