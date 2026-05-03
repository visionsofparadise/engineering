import { describe, expect, it } from "vitest";
import { BlockSumAccumulator } from "./block-sum";
import { KWeightedSquaredSum } from "./k-weighted-squared-sum";
import { IntegratedLufsAccumulator } from "./loudness";

describe("BlockSumAccumulator", () => {
	it("constant 1.0 input, blockSize=400, blockStep=100, frames=1000 → 7 closed blocks of sum 400", () => {
		const accumulator = new BlockSumAccumulator(400, 100);
		const input = new Float64Array(1000);

		input.fill(1);

		accumulator.push(input, 1000);

		const closed = accumulator.finalize();

		// Closed-block count = floor((1000 - 400) / 100) + 1 = 7.
		expect(closed.length).toBe(7);

		for (const sum of closed) {
			expect(sum).toBe(400);
		}
	});

	it("blockSize == blockStep → block sums equal disjoint sample-window sums", () => {
		const accumulator = new BlockSumAccumulator(100, 100);
		const input = new Float64Array(500);

		// Use a deterministic non-constant signal so disjoint windows
		// produce different sums.
		for (let i = 0; i < 500; i++) {
			input[i] = i;
		}

		accumulator.push(input, 500);

		const closed = accumulator.finalize();

		// 5 disjoint windows of 100 samples each, sums 0..99, 100..199, ...
		expect(closed.length).toBe(5);

		for (let blockIndex = 0; blockIndex < 5; blockIndex++) {
			let expected = 0;

			for (let i = blockIndex * 100; i < (blockIndex + 1) * 100; i++) expected += i;

			expect(closed[blockIndex]).toBe(expected);
		}
	});

	it("chunked push parity: same total signal in one push vs N pushes → same finalize() output", () => {
		const total = 4096;
		const input = new Float64Array(total);

		for (let i = 0; i < total; i++) input[i] = Math.sin(0.01 * i);

		const oneShot = new BlockSumAccumulator(400, 100);

		oneShot.push(input, total);

		const oneShotClosed = oneShot.finalize();

		const streamed = new BlockSumAccumulator(400, 100);
		const chunkSize = 333; // misaligned to both blockSize and blockStep

		for (let offset = 0; offset < total; offset += chunkSize) {
			const frames = Math.min(chunkSize, total - offset);
			const slice = input.subarray(offset, offset + frames);

			streamed.push(slice, frames);
		}

		const streamedClosed = streamed.finalize();

		expect(streamedClosed.length).toBe(oneShotClosed.length);

		for (let i = 0; i < oneShotClosed.length; i++) {
			expect(streamedClosed[i]).toBeCloseTo(oneShotClosed[i] ?? 0, 12);
		}
	});

	it("empty input → finalize() returns empty array", () => {
		const accumulator = new BlockSumAccumulator(400, 100);

		expect(accumulator.finalize()).toEqual([]);
	});

	it("re-finalize is idempotent", () => {
		const accumulator = new BlockSumAccumulator(100, 100);
		const input = new Float64Array(300);

		input.fill(2);
		accumulator.push(input, 300);

		const first = accumulator.finalize();
		const second = accumulator.finalize();

		expect(second).toBe(first);
	});

	it("push after finalize throws", () => {
		const accumulator = new BlockSumAccumulator(100, 100);

		accumulator.finalize();

		expect(() => accumulator.push(new Float64Array(10), 10)).toThrow(/finalize/);
	});

	it("constructor: non-positive blockSize throws", () => {
		expect(() => new BlockSumAccumulator(0, 100)).toThrow(/blockSize/);
	});

	it("constructor: non-positive blockStep throws", () => {
		expect(() => new BlockSumAccumulator(400, 0)).toThrow(/blockStep/);
	});

	// Composition test: drives KWeightedSquaredSum + BlockSumAccumulator
	// with BS.1770 400 ms / 100 ms parameters and cross-checks the closed
	// block sums against `IntegratedLufsAccumulator`'s internal state via
	// an indirect proof — the integrated LUFS computed from the closed
	// sums (with the same gating math) must match the accumulator's
	// finalize() output to within float tolerance.
	it("composition: closed block sums reproduce IntegratedLufsAccumulator's integrated LUFS within 1e-6", () => {
		const sampleRate = 48000;
		const durationSeconds = 5;
		const frames = sampleRate * durationSeconds;
		const input = new Float32Array(frames);

		// Mixed-frequency signal: 1 kHz tone + a slow modulator. Avoids
		// any pathological alignment with the 100 ms block step.
		for (let i = 0; i < frames; i++) {
			input[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate) + 0.05 * Math.sin((2 * Math.PI * 47 * i) / sampleRate);
		}

		// Ground truth via IntegratedLufsAccumulator.
		const reference = new IntegratedLufsAccumulator(sampleRate, 1);

		reference.push([input], frames);

		const referenceLufs = reference.finalize();

		// Composition path: K-weight → block sum.
		const blockSize = Math.round(0.4 * sampleRate);
		const blockStep = Math.round(0.1 * sampleRate);

		const kw = new KWeightedSquaredSum(sampleRate, 1);
		const blocks = new BlockSumAccumulator(blockSize, blockStep);
		const buffer = new Float64Array(frames);

		kw.push([input], frames, buffer);
		blocks.push(buffer, frames);

		const closed = blocks.finalize();

		// Apply BS.1770 two-stage gating manually — same math as
		// IntegratedLufsAccumulator.finalize. The point is to confirm
		// that the per-block raw sums from BlockSumAccumulator agree
		// with what IntegratedLufsAccumulator produced internally.
		const LUFS_OFFSET = -0.691;
		const ABSOLUTE_GATE_LUFS = -70;
		const RELATIVE_GATE_OFFSET_LU = -10;

		const absoluteThresholdPower = Math.pow(10, (ABSOLUTE_GATE_LUFS - LUFS_OFFSET) / 10);
		let absoluteSum = 0;
		let absoluteSurvivorCount = 0;

		for (const sum of closed) {
			const power = sum / blockSize;

			if (power > absoluteThresholdPower) {
				absoluteSum += power;
				absoluteSurvivorCount++;
			}
		}

		expect(absoluteSurvivorCount).toBeGreaterThan(0);

		const absoluteMean = absoluteSum / absoluteSurvivorCount;
		const relativeThresholdLufs = LUFS_OFFSET + 10 * Math.log10(absoluteMean) + RELATIVE_GATE_OFFSET_LU;
		const relativeThresholdPower = Math.pow(10, (relativeThresholdLufs - LUFS_OFFSET) / 10);

		let relativeSum = 0;
		let relativeSurvivorCount = 0;

		for (const sum of closed) {
			const power = sum / blockSize;

			if (power > absoluteThresholdPower && power > relativeThresholdPower) {
				relativeSum += power;
				relativeSurvivorCount++;
			}
		}

		const integratedMean = relativeSum / relativeSurvivorCount;
		const compositionLufs = LUFS_OFFSET + 10 * Math.log10(integratedMean);

		// Relative tolerance 1e-6 vs IntegratedLufsAccumulator output.
		expect(Math.abs(compositionLufs - referenceLufs)).toBeLessThan(1e-6);
	});
});
