import { describe, expect, it } from "vitest";
import { binaries, hasBinaryFixtures } from "../../../utils/test-binaries";
import { createOnnxSession } from "../../../utils/onnx-runtime";
import { BLOCK_SHIFT, DtlnBlockStream, WARMUP_SHIFTS, processDtlnFrames } from "./dtln";

/**
 * Bit-exact equivalence test for the new `DtlnBlockStream` streaming-block API.
 *
 * Builds two outputs for the same input signal:
 *
 * 1. **Whole-array reference** — `processDtlnFrames(signal)`, which itself is
 *    implemented atop `DtlnBlockStream` plus a warm-up/trim wrapper.
 * 2. **Manual streaming caller** — feeds the same signal `BLOCK_SHIFT` samples
 *    at a time directly into `DtlnBlockStream.step()`, then calls `flush()` and
 *    applies the same warm-up trim.
 *
 * The two paths must produce bit-identical output. If they ever diverge, the
 * `DtlnBlockStream` class has state leakage between blocks or its OLA
 * accumulation has drifted out of sync with what `processDtlnFrames` does
 * internally.
 */
const describeIfFixtureSet = hasBinaryFixtures("model1", "model2", "onnxAddon") ? describe : describe.skip;

describeIfFixtureSet("DtlnBlockStream bit-exact equivalence", () => {
	it("DtlnBlockStream.step + flush matches processDtlnFrames bit-for-bit on a 1-second test signal", () => {
		const session1 = createOnnxSession(binaries.onnxAddon, binaries.model1, { executionProviders: ["cpu"] });
		const session2 = createOnnxSession(binaries.onnxAddon, binaries.model2, { executionProviders: ["cpu"] });

		try {
			// 1 second @ 16 kHz = 16000 frames. Deterministic pseudo-random signal
			// (LCG, fixed seed) — avoids reliance on test audio fixtures and stays
			// representative of broadband noise that exercises the masking model.
			const length = 16000;
			const signal = new Float32Array(length);
			let state = 0x12_34_56_78;

			for (let index = 0; index < length; index++) {
				state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
				signal[index] = (state / 0x80_00_00_00 - 1) * 0.3;
			}

			// Reference: whole-array path.
			const reference = processDtlnFrames(signal, session1, session2);

			// Streaming: feed BLOCK_SHIFT-sized blocks one at a time, then flush.
			// Match the same totalSteps / warm-up / trim contract that
			// `processDtlnFrames` follows so the two outputs align.
			const BLOCK_LEN = 512;
			const effectiveLength = Math.max(length, BLOCK_LEN);
			const lastOffset = Math.floor((effectiveLength - BLOCK_LEN) / BLOCK_SHIFT) * BLOCK_SHIFT;
			const numBlocks = lastOffset / BLOCK_SHIFT + 1;
			const totalSteps = numBlocks + WARMUP_SHIFTS;

			const stream = new DtlnBlockStream({ session1, session2 });
			const stepOutputs: Array<Float32Array> = [];
			const stepInput = new Float32Array(BLOCK_SHIFT);

			for (let step = 0; step < totalSteps; step++) {
				const inputStart = step * BLOCK_SHIFT;
				const realAvail = Math.max(0, Math.min(BLOCK_SHIFT, length - inputStart));

				if (realAvail > 0) {
					stepInput.set(signal.subarray(inputStart, inputStart + realAvail));
				}
				if (realAvail < BLOCK_SHIFT) {
					stepInput.fill(0, realAvail, BLOCK_SHIFT);
				}

				stepOutputs.push(stream.step(stepInput));
			}

			const flushOutput = stream.flush();
			const warmupSamples = WARMUP_SHIFTS * BLOCK_SHIFT;
			const streamed = new Float32Array(length);
			let writeIdx = 0;
			let skip = warmupSamples;

			for (const out of stepOutputs) {
				if (writeIdx >= length) break;
				if (skip >= out.length) {
					skip -= out.length;
					continue;
				}

				const start = skip;

				skip = 0;
				const take = Math.min(out.length - start, length - writeIdx);

				streamed.set(out.subarray(start, start + take), writeIdx);
				writeIdx += take;
			}

			if (writeIdx < length) {
				const take = Math.min(flushOutput.length, length - writeIdx);

				streamed.set(flushOutput.subarray(0, take), writeIdx);
				writeIdx += take;
			}

			expect(streamed.length).toBe(reference.length);

			// Bit-exact: every sample identical (no tolerance).
			let firstDiff = -1;

			for (let index = 0; index < length; index++) {
				if (streamed[index] !== reference[index]) {
					firstDiff = index;
					break;
				}
			}

			expect(firstDiff).toBe(-1);
		} finally {
			session1.dispose();
			session2.dispose();
		}
	}, 60_000);
});
