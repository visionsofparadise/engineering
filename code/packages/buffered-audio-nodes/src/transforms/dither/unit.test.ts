import { describe, it, expect } from "vitest";
import { DitherStream } from ".";
import type { StreamContext } from "../../node";

const context: StreamContext = { executionProviders: ["cpu"], memoryLimit: 256 * 1024 * 1024 };

describe("DitherStream", () => {
	it("quantizes samples to 16-bit grid", () => {
		const stream = new DitherStream({ bitDepth: 16, noiseShaping: false, bufferSize: 0 }, context);
		const levels = Math.pow(2, 15);
		const input = new Float32Array([0.12345678, -0.98765432, 0, 0.5]);

		const result = stream._unbuffer({
			samples: [input],
			offset: 0,
			sampleRate: 44100,
			bitDepth: 32,
		});

		for (const sample of (result as { samples: Array<Float32Array> }).samples[0]!) {
			const scaled = Math.round(sample * levels);
			const snapped = scaled / levels;
			expect(Math.abs(sample - snapped)).toBeLessThan(1e-10);
		}
	});

	it("quantizes samples to 24-bit grid", () => {
		const stream = new DitherStream({ bitDepth: 24, noiseShaping: false, bufferSize: 0 }, context);
		const levels = Math.pow(2, 23);
		const input = new Float32Array([0.12345678, -0.98765432]);

		const result = stream._unbuffer({
			samples: [input],
			offset: 0,
			sampleRate: 44100,
			bitDepth: 32,
		});

		for (const sample of (result as { samples: Array<Float32Array> }).samples[0]!) {
			const scaled = Math.round(sample * levels);
			const snapped = scaled / levels;
			expect(Math.abs(sample - snapped)).toBeLessThan(1e-10);
		}
	});

	it("preserves silence", () => {
		const stream = new DitherStream({ bitDepth: 16, noiseShaping: false, bufferSize: 0 }, context);
		const input = new Float32Array(100).fill(0);

		const result = stream._unbuffer({
			samples: [input],
			offset: 0,
			sampleRate: 44100,
			bitDepth: 32,
		});

		for (const sample of (result as { samples: Array<Float32Array> }).samples[0]!) {
			expect(Math.abs(sample)).toBeLessThan(0.001);
		}
	});
});
