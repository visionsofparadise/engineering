import { BidirectionalIir } from "./bidirectional-iir";

describe("BidirectionalIir", () => {
	describe("identity at smoothingMs = 0", () => {
		it("applyBidirectional returns a fresh copy bit-for-bit equal to input", () => {
			const iir = new BidirectionalIir({ smoothingMs: 0, sampleRate: 48000 });
			const input = new Float32Array([0, 0.5, -0.25, 1, -1, 0.123, 0.999, 0]);

			const output = iir.applyBidirectional(input);

			expect(output).not.toBe(input);
			expect(output.length).toBe(input.length);

			for (let i = 0; i < input.length; i++) {
				expect(output[i]).toBe(input[i]);
			}
		});

		it("applyCausal returns a fresh copy bit-for-bit equal to input", () => {
			const iir = new BidirectionalIir({ smoothingMs: 0, sampleRate: 48000 });
			const input = new Float32Array([0, 0.5, -0.25, 1, -1, 0.123, 0.999, 0]);
			const state = { value: 0 };

			const output = iir.applyCausal(input, state);

			expect(output).not.toBe(input);
			expect(output.length).toBe(input.length);

			for (let i = 0; i < input.length; i++) {
				expect(output[i]).toBe(input[i]);
			}
		});
	});

	describe("step response settles toward 1", () => {
		it("bidirectional output settles toward 1 after the step and matches the expected -3 dB cutoff", () => {
			const sampleRate = 48000;
			const smoothingMs = 10;
			const iir = new BidirectionalIir({ smoothingMs, sampleRate });

			const length = 8192;
			const stepStart = length / 4;
			const input = new Float32Array(length);

			for (let i = stepStart; i < length; i++) input[i] = 1;

			const output = iir.applyBidirectional(input);

			// Far past the step the output should have settled near 1.
			const tail = output[length - 1] ?? 0;
			expect(tail).toBeGreaterThan(0.99);
			expect(tail).toBeLessThan(1.0001);

			// Far before the step the output should be small. Note the
			// backward pass smears the post-step value into the pre-step
			// region symmetrically, so this isn't strictly zero — but
			// well above the step start it should be a small fraction.
			const head = output[0] ?? 0;
			expect(Math.abs(head)).toBeLessThan(0.05);

			// Sanity-check the magnitude at the expected -3 dB cutoff.
			// For the bidirectional pass the user-facing smoothingMs maps
			// to the cutoff f_c = 1 / (2*pi*tau), tau = smoothingMs/1000.
			const cutoffHz = 1 / (2 * Math.PI * (smoothingMs / 1000));

			// Reference RMS of an unfiltered sine is sqrt(1/2) ~= 0.7071.
			const referenceRms = Math.SQRT1_2;

			const magnitudeAt = (frequencyHz: number): number => {
				// Pick a length that fits at least 8 full cycles so the
				// central-half RMS is well-defined for low frequencies.
				const cyclesNeeded = 8;
				const periodSamples = sampleRate / frequencyHz;
				const sineLength = Math.max(8192, Math.ceil(periodSamples * cyclesNeeded * 2));
				const sine = new Float32Array(sineLength);

				for (let i = 0; i < sineLength; i++) {
					sine[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
				}

				const filtered = iir.applyBidirectional(sine);

				// RMS of the central half — avoid edge transients.
				const startIdx = Math.floor(sineLength / 4);
				const endIdx = Math.floor((3 * sineLength) / 4);
				let sumSq = 0;

				for (let i = startIdx; i < endIdx; i++) {
					const v = filtered[i] ?? 0;
					sumSq += v * v;
				}

				return Math.sqrt(sumSq / (endIdx - startIdx));
			};

			const cutoffMagnitude = magnitudeAt(cutoffHz) / referenceRms;

			// At the nominal cutoff f = 1/(2*pi*tau), each individual
			// pass at tau_pass = sqrt(2)*tau has magnitude
			// 1/sqrt(1 + (2*pi*f*tau_pass)^2) = 1/sqrt(3). Cascading
			// two passes squares the magnitude to 1/3 ~= 0.333 — the
			// continuous-time analytic answer for the bidirectional
			// pass at this frequency. Tolerance covers discretization
			// and edge effects from a finite signal.
			expect(cutoffMagnitude).toBeGreaterThan(0.25);
			expect(cutoffMagnitude).toBeLessThan(0.45);

			// Far below cutoff should pass essentially unchanged.
			const lowMagnitude = magnitudeAt(cutoffHz / 8) / referenceRms;
			expect(lowMagnitude).toBeGreaterThan(0.95);

			// Far above cutoff should be strongly attenuated.
			const highMagnitude = magnitudeAt(cutoffHz * 50) / referenceRms;
			expect(highMagnitude).toBeLessThan(0.1);
		});
	});

	describe("zero phase response on a sine", () => {
		it("bidirectional output peaks align with input peaks for a sine well below cutoff", () => {
			const sampleRate = 48000;
			const smoothingMs = 10; // cutoff ~ 15.9 Hz
			const iir = new BidirectionalIir({ smoothingMs, sampleRate });

			const frequencyHz = 2; // well below cutoff
			const periodSamples = sampleRate / frequencyHz;
			const length = Math.round(periodSamples * 8); // 8 full cycles
			const input = new Float32Array(length);

			for (let i = 0; i < length; i++) {
				input[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
			}

			const output = iir.applyBidirectional(input);

			// Find the input peak near the middle of the signal (skipping
			// the IIR settling region) and the nearest output peak. They
			// should coincide within a small fraction of a period for a
			// zero-phase filter.
			const searchCenter = Math.floor(length / 2);
			const searchHalfWidth = Math.floor(periodSamples / 2);

			let inputPeakIdx = searchCenter;
			let inputPeakValue = input[searchCenter] ?? 0;

			for (let i = searchCenter - searchHalfWidth; i <= searchCenter + searchHalfWidth; i++) {
				const v = input[i] ?? 0;

				if (v > inputPeakValue) {
					inputPeakValue = v;
					inputPeakIdx = i;
				}
			}

			let outputPeakIdx = inputPeakIdx;
			let outputPeakValue = output[inputPeakIdx] ?? 0;

			for (let i = inputPeakIdx - searchHalfWidth; i <= inputPeakIdx + searchHalfWidth; i++) {
				const v = output[i] ?? 0;

				if (v > outputPeakValue) {
					outputPeakValue = v;
					outputPeakIdx = i;
				}
			}

			// Peaks should align within 1% of a period for a zero-phase
			// filter (the discretization granularity of peak-finding on
			// a pure sine alone bounds this to a few samples).
			const peakOffset = Math.abs(outputPeakIdx - inputPeakIdx);
			const tolerance = Math.ceil(periodSamples * 0.01);
			expect(peakOffset).toBeLessThanOrEqual(tolerance);
		});
	});

	describe("applyCausal state continuity", () => {
		it("two halves with state continuation match a single whole-input call", () => {
			const sampleRate = 48000;
			const smoothingMs = 5;
			const iir = new BidirectionalIir({ smoothingMs, sampleRate });

			const length = 4096;
			const input = new Float32Array(length);

			for (let i = 0; i < length; i++) {
				input[i] = Math.sin((2 * Math.PI * 100 * i) / sampleRate) + 0.3;
			}

			const wholeState = { value: 0 };
			const whole = iir.applyCausal(input, wholeState);

			const halfPoint = length / 2;
			const firstHalf = input.slice(0, halfPoint);
			const secondHalf = input.slice(halfPoint);

			const splitState = { value: 0 };
			const firstOut = iir.applyCausal(firstHalf, splitState);
			const secondOut = iir.applyCausal(secondHalf, splitState);

			for (let i = 0; i < halfPoint; i++) {
				expect(firstOut[i]).toBeCloseTo(whole[i]!, 6);
			}

			for (let i = 0; i < halfPoint; i++) {
				expect(secondOut[i]).toBeCloseTo(whole[i + halfPoint]!, 6);
			}
		});
	});

	describe("output length matches input length", () => {
		it("applyBidirectional preserves length", () => {
			const iir = new BidirectionalIir({ smoothingMs: 10, sampleRate: 48000 });

			for (const length of [0, 1, 17, 4096]) {
				const input = new Float32Array(length);
				const output = iir.applyBidirectional(input);
				expect(output.length).toBe(length);
			}
		});

		it("applyCausal preserves length", () => {
			const iir = new BidirectionalIir({ smoothingMs: 10, sampleRate: 48000 });

			for (const length of [0, 1, 17, 4096]) {
				const input = new Float32Array(length);
				const state = { value: 0 };
				const output = iir.applyCausal(input, state);
				expect(output.length).toBe(length);
			}
		});
	});

	describe("non-mutation", () => {
		it("applyBidirectional does not mutate input", () => {
			const iir = new BidirectionalIir({ smoothingMs: 10, sampleRate: 48000 });
			const input = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]);
			const reference = Float32Array.from(input);

			iir.applyBidirectional(input);

			for (let i = 0; i < input.length; i++) {
				expect(input[i]).toBe(reference[i]);
			}
		});

		it("applyCausal does not mutate input", () => {
			const iir = new BidirectionalIir({ smoothingMs: 10, sampleRate: 48000 });
			const input = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0]);
			const reference = Float32Array.from(input);
			const state = { value: 0 };

			iir.applyCausal(input, state);

			for (let i = 0; i < input.length; i++) {
				expect(input[i]).toBe(reference[i]);
			}
		});
	});
});
