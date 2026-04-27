import { describe, expect, it } from "vitest";
import { detectArResidual } from "./bmri-ar-detection";

function makePinkNoise(length: number, seed: number): Float32Array {
	// Paul Kellet's "economy" pink-noise filter — good enough for test fixtures.
	const signal = new Float32Array(length);
	let s = seed;
	const rand = (): number => {
		s = (s * 48271) % 2147483647;

		return (s / 2147483647) * 2 - 1;
	};
	let b0 = 0;
	let b1 = 0;
	let b2 = 0;

	for (let i = 0; i < length; i++) {
		const white = rand();

		b0 = 0.99765 * b0 + white * 0.099046;
		b1 = 0.96300 * b1 + white * 0.2965164;
		b2 = 0.57000 * b2 + white * 1.0526913;

		signal[i] = (b0 + b1 + b2 + white * 0.1848) * 0.05;
	}

	return signal;
}

function countFlagged(flagged: Uint8Array): number {
	let n = 0;

	for (let i = 0; i < flagged.length; i++) {
		if ((flagged[i] ?? 0) === 1) n++;
	}

	return n;
}

describe("detectArResidual", () => {
	it("flags exactly round(γ·N) samples on pink noise with no impulses", () => {
		const block = makePinkNoise(2048, 1234);
		const { flagged } = detectArResidual(block, 32, 0.1);
		const expected = Math.round(2048 * 0.1);

		expect(countFlagged(flagged)).toBe(expected);
	});

	it("flags zero samples at gammaFraction = 0", () => {
		const block = makePinkNoise(2048, 1234);
		const { flagged } = detectArResidual(block, 32, 0);

		expect(countFlagged(flagged)).toBe(0);
	});

	it("clamps gammaFraction ≥ 0.5 to 0.5 (well-posedness of LSAR solve)", () => {
		const block = makePinkNoise(2048, 5678);
		const { flagged } = detectArResidual(block, 32, 0.7);
		const expected = Math.round(2048 * 0.5);

		expect(countFlagged(flagged)).toBe(expected);
	});

	it("flags a synthetic impulse inserted into pink noise", () => {
		const block = makePinkNoise(2048, 999);
		// Peak amplitude of the pink-noise block.
		let peak = 0;

		for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i] ?? 0));

		// Insert an impulse at sample 1000 with 10× the peak amplitude.
		block[1000] = peak * 10;

		const { flagged } = detectArResidual(block, 32, 0.01);

		expect(flagged[1000]).toBe(1);
	});
});
