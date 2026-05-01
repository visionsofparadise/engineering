/* eslint-disable no-console -- the node logs an iteration summary by design; tests run with vitest, console output is fine in CI. */
import { describe, expect, it } from "vitest";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { MemoryChunkBuffer, type AudioChunk } from "@e9g/buffered-audio-nodes-core";
import { loudnessCurve, LoudnessCurveStream, schema, streamingAmplitudeHistogram } from ".";

/**
 * Wrap per-channel arrays in a `MemoryChunkBuffer` and run the
 * streaming negative-only histogram primitive. Compat shim for the
 * existing regression tests originally written against
 * `computeNegativeHistogram(channels, bucketCount)` — preserves the
 * call shape while exercising the streaming implementation that
 * replaces the in-memory primitive.
 */
async function negativeHistogramFromChannels(channels: ReadonlyArray<Float32Array>, bucketCount: number, sampleRate = TEST_SAMPLE_RATE): Promise<{ bucketMax: number; median: number }> {
	const buffer = new MemoryChunkBuffer(Infinity, channels.length);

	await buffer.append(channels.map((channel) => new Float32Array(channel)), sampleRate, 32);

	return streamingAmplitudeHistogram(buffer, bucketCount, "negative-only", sampleRate);
}

const TEST_SAMPLE_RATE = 48_000;
const TEST_FRAMES = TEST_SAMPLE_RATE * 4; // 4 s — long enough for BS.1770 gating.

function measureLufs(channels: ReadonlyArray<Float32Array>, sampleRate: number): number {
	const accumulator = new IntegratedLufsAccumulator(sampleRate, channels.length);

	accumulator.push(channels, channels[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Deterministic synthetic source: low-frequency sine + small high-frequency
 * sine + LCG-seeded white noise. Models the broadband / multi-tone character
 * the loudness-curve learn pass is designed to consume; the integrated LUFS
 * lands in a sane podcast/voice-like range at amplitude 0.1.
 */
function makeSynthetic(frames: number, sampleRate: number, seed = 1): Float32Array {
	const out = new Float32Array(frames);
	let state = seed >>> 0;

	for (let index = 0; index < frames; index++) {
		state = (state * 1664525 + 1013904223) >>> 0;

		const noise = (state / 0xffffffff - 0.5) * 0.05;
		const fundamental = Math.sin((2 * Math.PI * 220 * index) / sampleRate) * 0.08;
		const harmonic = Math.sin((2 * Math.PI * 880 * index) / sampleRate) * 0.02;

		out[index] = fundamental + harmonic + noise;
	}

	return out;
}

/**
 * Drive the LoudnessCurveStream end-to-end (without involving file I/O).
 * Mirrors the "renders end-to-end with no ffmpeg involvement" pattern in
 * `loudness-normalize/unit.test.ts` — write the input chunk(s), close the
 * writer, drain the readable concurrently, reassemble per-channel arrays.
 */
async function runStream(channels: ReadonlyArray<Float32Array>, sampleRate: number, properties: { target: number; density?: number; warmth?: number; floor?: number }): Promise<Array<Float32Array>> {
	const channelCount = channels.length;
	const stream = new LoudnessCurveStream({
		target: properties.target,
		density: properties.density ?? 1,
		warmth: properties.warmth ?? 0,
		floor: properties.floor ?? -1000,
		bufferSize: Infinity,
		overlap: 0,
	});
	const transformStream = stream.createTransformStream();
	const writer = transformStream.writable.getWriter();
	const reader = transformStream.readable.getReader();

	const drain = (async () => {
		const collected: Array<Array<Float32Array>> = [];

		while (true) {
			const next = await reader.read();

			if (next.done) return collected;

			collected.push(next.value.samples);
		}
	})();

	const samples: Array<Float32Array> = [];

	for (const channel of channels) samples.push(channel);

	const chunk: AudioChunk = { samples, offset: 0, sampleRate, bitDepth: 32 };

	await writer.write(chunk);
	await writer.close();

	const collected = await drain;

	// Reassemble per channel.
	const lengths = new Array<number>(channelCount).fill(0);

	for (const piece of collected) {
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			lengths[channelIndex] = (lengths[channelIndex] ?? 0) + (piece[channelIndex]?.length ?? 0);
		}
	}

	const out: Array<Float32Array> = [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		out.push(new Float32Array(lengths[channelIndex] ?? 0));
	}

	const offsets = new Array<number>(channelCount).fill(0);

	for (const piece of collected) {
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const slice = piece[channelIndex];

			if (!slice) continue;

			out[channelIndex]?.set(slice, offsets[channelIndex] ?? 0);
			offsets[channelIndex] = (offsets[channelIndex] ?? 0) + slice.length;
		}
	}

	return out;
}

describe("LoudnessCurve schema", () => {
	it("applies defaults for all fields when no options are supplied", () => {
		const parsed = schema.parse({});

		expect(parsed.target).toBe(-16);
		expect(parsed.density).toBe(1);
		expect(parsed.warmth).toBe(0);
		expect(parsed.floor).toBe(-1000);
	});

	it("accepts explicit values within range", () => {
		const parsed = schema.parse({ target: -10, density: 2.5, warmth: 0.3, floor: -60 });

		expect(parsed.target).toBe(-10);
		expect(parsed.density).toBe(2.5);
		expect(parsed.warmth).toBeCloseTo(0.3, 10);
		expect(parsed.floor).toBe(-60);
	});

	it("rejects floor > 0 (must be a non-positive dB value)", () => {
		expect(() => schema.parse({ floor: 1 })).toThrow();
	});

	it("rejects density <= 0", () => {
		expect(() => schema.parse({ density: 0 })).toThrow();
		expect(() => schema.parse({ density: -1 })).toThrow();
	});

	it("rejects warmth outside [0, 1]", () => {
		expect(() => schema.parse({ warmth: -0.1 })).toThrow();
		expect(() => schema.parse({ warmth: 1.5 })).toThrow();
	});

	it("rejects target outside the LUFS range", () => {
		expect(() => schema.parse({ target: -100 })).toThrow();
		expect(() => schema.parse({ target: 5 })).toThrow();
	});

	it("accepts target = 0 and target = -50 (range edges)", () => {
		expect(schema.parse({ target: 0 }).target).toBe(0);
		expect(schema.parse({ target: -50 }).target).toBe(-50);
	});

	it("loudnessCurve() factory parses options through the schema", () => {
		const node = loudnessCurve({ target: -12, density: 1.5, warmth: 0.2 });

		expect(node.properties.target).toBe(-12);
		expect(node.properties.density).toBe(1.5);
		expect(node.properties.warmth).toBeCloseTo(0.2, 10);
	});

	it("loudnessCurve() factory falls back to defaults", () => {
		const node = loudnessCurve();

		expect(node.properties.target).toBe(-16);
		expect(node.properties.density).toBe(1);
		expect(node.properties.warmth).toBe(0);
	});
});

describe("LoudnessCurve end-to-end", () => {
	const TEST_TIMEOUT_MS = 120_000;

	it("hits target LUFS within ~1 dB on a synthetic broadband source", async () => {
		// 0.5 dB iteration tolerance + ~0.3 dB iteration-vs-final bias ≈ 1.0 dB.
		// Bias documented in plan §4.2; the assertion is intentionally loose.
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 1);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = sourceLufs + 3;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target });
		const outputChannel = output[0];

		expect(outputChannel).toBeDefined();
		expect(outputChannel?.length).toBe(input.length);

		const measured = measureLufs([outputChannel ?? new Float32Array(0)], TEST_SAMPLE_RATE);

		expect(Math.abs(measured - target)).toBeLessThan(1.0);
	}, TEST_TIMEOUT_MS);

	it("produces near-identity output when target equals source LUFS (zero-boost convergence)", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 2);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		// Target rounded to one decimal to satisfy the schema's `multipleOf(0.1)`
		// constraint without changing the test intent — the iteration converges
		// at boost ≈ 0 either way.
		const target = Math.round(sourceLufs * 10) / 10;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target });
		const outputChannel = output[0] ?? new Float32Array(0);

		expect(outputChannel.length).toBe(input.length);

		// Output LUFS within iteration tolerance + bias of source.
		const measuredOut = measureLufs([outputChannel], TEST_SAMPLE_RATE);

		expect(Math.abs(measuredOut - sourceLufs)).toBeLessThan(1.0);

		// Per-sample comparison — at boost ≈ 0 the LUT is near-identity, so
		// output ≈ input within (a) the 4× oversample-roundtrip tolerance the
		// Phase 4 identity-LUT test uses (0.005), plus (b) the residual body-
		// lift from the small non-zero converged boost (the iteration may
		// converge with `bestBoost` ≈ 1e-3 because rounding `target * 10`
		// shifts the target by at most 0.05 dB). Probe a handful of samples
		// in the settled second half to skip the biquad warm-up transient.
		const probeStart = Math.floor(input.length / 2);
		const probes = [probeStart, probeStart + 100, probeStart + 1000, probeStart + 12345, input.length - 1];

		for (const index of probes) {
			const expected = input[index] ?? 0;
			const actual = outputChannel[index] ?? 0;

			expect(Math.abs(actual - expected)).toBeLessThan(0.05);
		}
	}, TEST_TIMEOUT_MS);

	it("tolerates 32-bit-float overflow at low density / high target", async () => {
		// At density = 0.3 the curve is convex on each segment — samples just
		// below max get a near-uniform multiplicative boost. With target above
		// source and a high-amplitude source, output samples can exceed ±1.0.
		// The node does not clamp (per design "No output clamping"); the test
		// asserts no NaN/Inf and that nothing crashes.
		const input = new Float32Array(TEST_FRAMES);
		let state = 7;

		for (let index = 0; index < TEST_FRAMES; index++) {
			state = (state * 1664525 + 1013904223) >>> 0;

			const noise = (state / 0xffffffff - 0.5) * 0.4;
			const tone = Math.sin((2 * Math.PI * 200 * index) / TEST_SAMPLE_RATE) * 0.6;

			input[index] = tone + noise;
		}

		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.min(0, Math.round((sourceLufs + 6) * 10) / 10);
		const output = await runStream([input], TEST_SAMPLE_RATE, { target, density: 0.3 });
		const outputChannel = output[0] ?? new Float32Array(0);

		expect(outputChannel.length).toBe(input.length);

		// Nothing should be NaN/Inf. Output samples may exceed ±1.0 — that's
		// the design contract.
		let observedPeak = 0;

		for (let index = 0; index < outputChannel.length; index++) {
			const sample = outputChannel[index] ?? 0;

			expect(Number.isFinite(sample)).toBe(true);

			const absolute = Math.abs(sample);

			if (absolute > observedPeak) observedPeak = absolute;
		}

		// Sanity: at density = 0.3 with a +6 dB target, the boost is almost
		// certain to push the peak above 1.0 — the test exists because the
		// node must handle that without crashing or saturating.
		expect(observedPeak).toBeGreaterThan(0.5);
	}, TEST_TIMEOUT_MS);

	it("processes a stereo source with each channel intact", async () => {
		const left = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 11);
		const right = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 23);
		const sourceLufs = measureLufs([left, right], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([left, right], TEST_SAMPLE_RATE, { target });

		expect(output).toHaveLength(2);
		expect(output[0]?.length).toBe(left.length);
		expect(output[1]?.length).toBe(right.length);

		// Both channels produced finite output.
		for (const channel of output) {
			for (let index = 0; index < (channel?.length ?? 0); index++) {
				expect(Number.isFinite(channel?.[index] ?? 0)).toBe(true);
			}
		}

		// LUFS lands within the same ~1 dB end-to-end tolerance for stereo.
		const measured = measureLufs([output[0] ?? new Float32Array(0), output[1] ?? new Float32Array(0)], TEST_SAMPLE_RATE);

		expect(Math.abs(measured - target)).toBeLessThan(1.0);

		// Channel independence: distinct seeds in → distinct outputs out.
		const leftOut = output[0] ?? new Float32Array(0);
		const rightOut = output[1] ?? new Float32Array(0);
		let differingSamples = 0;

		for (let index = 0; index < leftOut.length; index++) {
			if ((leftOut[index] ?? 0) !== (rightOut[index] ?? 0)) differingSamples++;
		}

		expect(differingSamples).toBeGreaterThan(leftOut.length / 2);
	}, TEST_TIMEOUT_MS);
});

/**
 * Build an asymmetric deterministic source where the |x| distribution of
 * the negative half differs significantly from the positive half. Used by
 * the warmth > 0 correctness tests. Positive samples land uniformly in
 * `[0, 0.3]`; negative samples land uniformly in `[-0.6, 0]`. Each frame
 * randomly chooses the sign so neither half is empty.
 *
 * The negative-only |x| distribution is approximately uniform on
 * `[0, 0.6]` → analytical median ≈ 0.3. The full-buffer |x| distribution
 * is bimodal-ish but the median computed over the entire array (with
 * positives mixed in) is ≈ 0.15.
 */
function makeAsymmetric(frames: number, seed = 1): Float32Array {
	const out = new Float32Array(frames);
	let state = seed >>> 0;

	for (let index = 0; index < frames; index++) {
		state = (state * 1664525 + 1013904223) >>> 0;

		const u1 = state / 0xffffffff;

		state = (state * 1664525 + 1013904223) >>> 0;

		const u2 = state / 0xffffffff;

		// 50/50 sign split. Negative samples in [-0.6, 0]; positive in [0, 0.3].
		out[index] = u1 < 0.5 ? -u2 * 0.6 : u2 * 0.3;
	}

	return out;
}

/** Per-half RMS — proxy for whether the curve treated negatives differently from positives. */
function halfRms(channel: Float32Array): { negRms: number; posRms: number } {
	let negSumSq = 0;
	let posSumSq = 0;
	let negCount = 0;
	let posCount = 0;

	for (let index = 0; index < channel.length; index++) {
		const sample = channel[index] ?? 0;

		if (sample < 0) {
			negSumSq += sample * sample;
			negCount++;
		} else if (sample > 0) {
			posSumSq += sample * sample;
			posCount++;
		}
	}

	return {
		negRms: negCount > 0 ? Math.sqrt(negSumSq / negCount) : 0,
		posRms: posCount > 0 ? Math.sqrt(posSumSq / posCount) : 0,
	};
}

describe("streamingAmplitudeHistogram (negative-only)", () => {
	it("computes the median of the negative-only |x| distribution (not a padded distribution)", async () => {
		// Construct a channel where the analytical negative-only median
		// is provably distinct from a same-length-zero-padded median.
		// Negatives sweep |x| from 0.01 to 1.0 in 100 steps; positives are
		// 100 samples of +0.5. Negative-only median ≈ 0.5 (the midpoint of
		// the 100-step sweep). If the helper instead measured |x| over the
		// full 200-sample buffer with positives masked to 0, bucket 0
		// would absorb the 100 zeros and the median would land ≈ 0.255.
		const channel = new Float32Array(200);

		for (let index = 0; index < 100; index++) {
			channel[index] = -((index + 1) / 100); // -0.01 .. -1.0
		}

		for (let index = 100; index < 200; index++) {
			channel[index] = 0.5;
		}

		const histogram = await negativeHistogramFromChannels([channel], 1024);

		// Negative-only |x| values: uniform-ish in (0, 1.0], analytical
		// median = 0.505 (midpoint of {0.01, 0.02, ..., 1.0}).
		expect(histogram.bucketMax).toBeCloseTo(1.0, 6);
		expect(histogram.median).toBeGreaterThan(0.45);
		expect(histogram.median).toBeLessThan(0.55);
	});

	it("returns degenerate histogram when a channel has no negative samples", async () => {
		const channel = new Float32Array(100);

		for (let index = 0; index < 100; index++) {
			channel[index] = 0.1 + index * 0.001;
		}

		const histogram = await negativeHistogramFromChannels([channel], 1024);

		expect(histogram.bucketMax).toBe(0);
		expect(histogram.median).toBe(0);
	});

	it("counts negatives across multiple channels", async () => {
		const left = new Float32Array([0.5, 0.5, 0.5, 0.5]);
		const right = new Float32Array([-0.2, -0.4, -0.6, -0.8]);

		const histogram = await negativeHistogramFromChannels([left, right], 1024);

		// Only the right channel's 4 negatives contribute. Median of
		// {0.2, 0.4, 0.6, 0.8} is 0.5 (linear-interpolated within bucket).
		expect(histogram.bucketMax).toBeCloseTo(0.8, 6);
		expect(histogram.median).toBeGreaterThan(0.4);
		expect(histogram.median).toBeLessThan(0.6);
	});
});

describe("LoudnessCurve warmth > 0 correctness", () => {
	const TEST_TIMEOUT_MS = 120_000;

	it("warmth = 1 on an asymmetric source converges and produces sane output (end-to-end smoke test)", async () => {
		// Asymmetric source: negatives in [-0.6, 0], positives in [0, 0.3].
		// Smoke test that warmth = 1 doesn't crash, produces finite output,
		// and converges to target within tolerance on a source where the
		// negative-half median differs significantly from the positive-half
		// median. The histogram-direct correctness tests above are the
		// load-bearing regression tests for the median-collapse bug — this
		// end-to-end test only verifies the integration path doesn't blow
		// up at warmth > 0 (which the pre-existing 12-test suite never
		// exercised).
		const input = makeAsymmetric(TEST_FRAMES, 17);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;

		const warmOutput = await runStream([input], TEST_SAMPLE_RATE, { target, warmth: 1 });
		const warmChannel = warmOutput[0] ?? new Float32Array(0);

		expect(warmChannel.length).toBe(input.length);

		for (let index = 0; index < warmChannel.length; index++) {
			expect(Number.isFinite(warmChannel[index] ?? 0)).toBe(true);
		}

		const warmLufs = measureLufs([warmChannel], TEST_SAMPLE_RATE);

		expect(Math.abs(warmLufs - target)).toBeLessThan(1.0);

		// Sanity: per-half RMS is non-zero on both sides — confirms the
		// curve actually produced output samples on each half rather than
		// silencing one side.
		const warmHalf = halfRms(warmChannel);

		expect(warmHalf.negRms).toBeGreaterThan(0);
		expect(warmHalf.posRms).toBeGreaterThan(0);
	}, TEST_TIMEOUT_MS);

	it("warmth = 1 on all-positive content falls through to pass-through (degenerate negative histogram)", async () => {
		// Build an all-positive source. The combined |x| histogram is fine
		// (positiveHistogram has data), but the negative-only histogram
		// has zero samples → bucketMax = 0, triggering the existing
		// degenerate-histogram bail-out in _process.
		const input = new Float32Array(TEST_FRAMES);
		let state = 31;

		for (let index = 0; index < TEST_FRAMES; index++) {
			state = (state * 1664525 + 1013904223) >>> 0;

			const u = state / 0xffffffff;

			// Strictly positive. Use a DC-offset half-rectified noise so the
			// LUFS measurement still gates clearly above silence.
			input[index] = 0.05 + u * 0.2;
		}

		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);

		// Note: all-positive DC-biased input still has measurable
		// integrated LUFS because BS.1770 K-filters out DC and measures
		// the AC envelope. The interesting assertion is that the node
		// completes without NaN/Inf and respects the bail-out path.
		const target = Number.isFinite(sourceLufs) ? Math.round((sourceLufs + 3) * 10) / 10 : -16;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target, warmth: 1 });
		const outputChannel = output[0] ?? new Float32Array(0);

		expect(outputChannel.length).toBe(input.length);

		// Pass-through: output should equal input bit-for-bit (no LUT
		// applied because the negative-half histogram is degenerate).
		for (let index = 0; index < input.length; index++) {
			expect(outputChannel[index]).toBe(input[index]);
		}
	}, TEST_TIMEOUT_MS);
});

/**
 * Drive the LoudnessCurveStream by writing the source as multiple
 * chunks rather than a single whole-source chunk. Used by the
 * streaming-refactor regression tests to exercise the chunk-by-chunk
 * `_unbuffer` apply path with persistent oversamplers — the failure
 * mode the refactor exists to fix is invisible if the source is
 * delivered as one chunk, because then `_unbuffer` runs once and there
 * is no chunk boundary to test.
 *
 * The output emit chunk size is inferred from the first input chunk
 * (`BufferedTransformStream.inferredChunkSize`), so passing
 * `chunkFrames < input.length` produces multiple output chunks too.
 */
async function runStreamChunked(channels: ReadonlyArray<Float32Array>, sampleRate: number, properties: { target: number; density?: number; warmth?: number; floor?: number }, chunkFrames: number): Promise<Array<Float32Array>> {
	const channelCount = channels.length;
	const stream = new LoudnessCurveStream({
		target: properties.target,
		density: properties.density ?? 1,
		warmth: properties.warmth ?? 0,
		floor: properties.floor ?? -1000,
		bufferSize: Infinity,
		overlap: 0,
	});
	const transformStream = stream.createTransformStream();
	const writer = transformStream.writable.getWriter();
	const reader = transformStream.readable.getReader();

	const drain = (async () => {
		const collected: Array<Array<Float32Array>> = [];

		while (true) {
			const next = await reader.read();

			if (next.done) return collected;

			collected.push(next.value.samples);
		}
	})();

	const totalFrames = channels[0]?.length ?? 0;
	let offset = 0;

	while (offset < totalFrames) {
		const take = Math.min(chunkFrames, totalFrames - offset);
		const samples: Array<Float32Array> = channels.map((channel) => channel.slice(offset, offset + take));
		const chunk: AudioChunk = { samples, offset, sampleRate, bitDepth: 32 };

		await writer.write(chunk);
		offset += take;
	}

	await writer.close();

	const collected = await drain;

	const lengths = new Array<number>(channelCount).fill(0);

	for (const piece of collected) {
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			lengths[channelIndex] = (lengths[channelIndex] ?? 0) + (piece[channelIndex]?.length ?? 0);
		}
	}

	const out: Array<Float32Array> = [];

	for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
		out.push(new Float32Array(lengths[channelIndex] ?? 0));
	}

	const offsets = new Array<number>(channelCount).fill(0);

	for (const piece of collected) {
		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			const slice = piece[channelIndex];

			if (!slice) continue;

			out[channelIndex]?.set(slice, offsets[channelIndex] ?? 0);
			offsets[channelIndex] = (offsets[channelIndex] ?? 0) + slice.length;
		}
	}

	return out;
}

describe("LoudnessCurve streaming refactor", () => {
	const TEST_TIMEOUT_MS = 180_000;

	it("hits target LUFS on a 30 s synthetic source (long-duration constant-memory smoke test)", async () => {
		// 30 s at 48 kHz stereo = 2.88 M samples per channel. The pre-
		// refactor implementation called `buffer.read(0, frames)` and
		// allocated full-length applied buffers per iteration attempt;
		// post-refactor the node holds only one chunk's worth of working
		// memory at any time. This test exercises the streaming path on
		// a source long enough that any per-attempt full-length allocation
		// would be visible in heap usage. We assert correctness — LUFS
		// hits target — rather than measuring memory directly.
		const frames = TEST_SAMPLE_RATE * 30;
		const left = makeSynthetic(frames, TEST_SAMPLE_RATE, 101);
		const right = makeSynthetic(frames, TEST_SAMPLE_RATE, 202);
		const sourceLufs = measureLufs([left, right], TEST_SAMPLE_RATE);

		expect(Number.isFinite(sourceLufs)).toBe(true);

		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([left, right], TEST_SAMPLE_RATE, { target });

		expect(output[0]?.length).toBe(left.length);
		expect(output[1]?.length).toBe(right.length);

		const measured = measureLufs([output[0] ?? new Float32Array(0), output[1] ?? new Float32Array(0)], TEST_SAMPLE_RATE);

		// Same ~1 dB tolerance as the existing end-to-end tests.
		expect(Math.abs(measured - target)).toBeLessThan(1.0);
	}, TEST_TIMEOUT_MS);

	it("multi-chunk input produces output identical to single-chunk input (oversampler state is chunk-continuous)", async () => {
		// The refactor moved the apply pass from a whole-buffer one-shot
		// into chunk-by-chunk `_unbuffer` with persistent per-channel
		// Oversamplers. If oversampler state were not actually preserved
		// across chunks (e.g. if `_unbuffer` reset state, or if the apply
		// path allocated fresh oversamplers per call), the output would
		// drift from the whole-buffer reference at every chunk boundary.
		//
		// This test renders the same input two ways:
		//   1. As a single whole-source chunk (one `_unbuffer` call).
		//   2. As a stream of small chunks (many `_unbuffer` calls).
		// The learn pass is identical between runs (same source, same
		// histogram, same iteration → same winning LUT), so any
		// difference between the two outputs is attributable to the
		// chunk-by-chunk apply path's state-continuity behavior. A
		// match within float epsilon proves the Oversampler state
		// genuinely persists across `_unbuffer` calls.
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 7);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;

		const single = await runStream([input], TEST_SAMPLE_RATE, { target });
		const chunked = await runStreamChunked([input], TEST_SAMPLE_RATE, { target }, 4096);

		const singleChannel = single[0] ?? new Float32Array(0);
		const chunkedChannel = chunked[0] ?? new Float32Array(0);

		expect(singleChannel.length).toBe(input.length);
		expect(chunkedChannel.length).toBe(input.length);

		// Float-epsilon match: per-sample difference from the LUT lookup
		// path is rounding only (LUT lookup is deterministic), and the
		// Oversampler's biquad runs in identical state at every sample
		// position when the upstream chunking is the only difference.
		// Tolerance 1e-6 leaves headroom for accumulated float rounding
		// over a 4 s buffer without admitting a real chunk-boundary
		// glitch (which would manifest as a ~1e-2 jump at every
		// boundary).
		let maxError = 0;

		for (let index = 0; index < singleChannel.length; index++) {
			const diff = Math.abs((singleChannel[index] ?? 0) - (chunkedChannel[index] ?? 0));

			if (diff > maxError) maxError = diff;
		}

		expect(maxError).toBeLessThan(1e-6);
	}, TEST_TIMEOUT_MS);
});

describe("LoudnessCurve floor parameter", () => {
	const TEST_TIMEOUT_MS = 120_000;

	/**
	 * Synthetic source modelling voice-with-silences: half the frames hold
	 * deterministic body-amplitude content (~0.1–0.5), half hold near-zero
	 * silence (`±1e-6`). Without a floor, the silence pile-up collapses
	 * the |x| histogram median toward zero. With a `-60 dB` (≈ 1e-3
	 * linear) floor, only the body samples contribute and the median
	 * lands within the body's own distribution.
	 *
	 * Returns the channel plus the analytically-known body median (the
	 * mean amplitude of the body samples, used as a coarse expectation
	 * for the post-floor median).
	 */
	function makeVoiceWithSilences(frames: number, seed: number): { channel: Float32Array; bodyMedianApprox: number } {
		const channel = new Float32Array(frames);
		let state = seed >>> 0;
		const bodySamples: Array<number> = [];

		for (let index = 0; index < frames; index++) {
			state = (state * 1664525 + 1013904223) >>> 0;

			const u = state / 0xffffffff;

			if (index % 2 === 0) {
				// Body: |x| in [0.1, 0.5] with random sign.
				const magnitude = 0.1 + u * 0.4;

				state = (state * 1664525 + 1013904223) >>> 0;

				const sign = (state & 1) === 0 ? 1 : -1;

				channel[index] = sign * magnitude;
				bodySamples.push(magnitude);
			} else {
				// Silence: ±1e-6, well below the -60 dB floor (≈ 1e-3).
				channel[index] = (state & 1) === 0 ? 1e-6 : -1e-6;
			}
		}

		bodySamples.sort((a, b) => a - b);
		const midIndex = Math.floor(bodySamples.length / 2);
		const bodyMedianApprox = bodySamples[midIndex] ?? 0;

		return { channel, bodyMedianApprox };
	}

	it("excludes silence from histogram median (voice-with-silences source)", async () => {
		// Direct streamingAmplitudeHistogram test — the load-bearing one
		// for the median-collapse motivation.
		const FRAMES = 100_000;
		const { channel, bodyMedianApprox } = makeVoiceWithSilences(FRAMES, 0xC0FFEE);
		const buffer = new MemoryChunkBuffer(Infinity, 1);

		await buffer.append([new Float32Array(channel)], TEST_SAMPLE_RATE, 32);

		const FLOOR_LINEAR_NEG_60_DB = Math.pow(10, -60 / 20); // ≈ 1.0e-3.

		const noFloor = await streamingAmplitudeHistogram(buffer, 1024, "absolute", TEST_SAMPLE_RATE, 0);
		const withFloor = await streamingAmplitudeHistogram(buffer, 1024, "absolute", TEST_SAMPLE_RATE, FLOOR_LINEAR_NEG_60_DB);

		// Without the floor, half the buffer is ~zero — the cumulative
		// count crosses the 50th percentile inside the first bucket and
		// the median collapses toward zero.
		expect(noFloor.median).toBeLessThan(0.05);

		// With the floor, the histogram only sees body samples; the
		// median lands in the body's own distribution (analytical ≈ 0.3).
		expect(withFloor.median).toBeGreaterThan(0.15);
		expect(withFloor.median).toBeLessThan(0.45);
		// And it tracks the analytical body median within bucket-width
		// resolution (max / 1024 ≈ 5e-4 for max ≈ 0.5).
		expect(Math.abs(withFloor.median - bodyMedianApprox)).toBeLessThan(0.05);
	});

	it("passes silence through unchanged at apply time (per-sample identity for sub-floor input)", async () => {
		// End-to-end: source has body content (drives a non-trivial LUT
		// and oversampler) plus a few interleaved sub-floor samples.
		// Body samples should be transformed; sub-floor samples should
		// emerge bit-identical to input.
		//
		// We probe specific sub-floor frames in the settled middle of the
		// stream to skip the biquad warm-up transient. The Oversampler's
		// upsampled `(x)` callback runs at 4× rate; an exact-zero input
		// frame produces an exact-zero output sample at that frame
		// position because the polyphase upsampler emits a true zero at
		// the original-sample slot when the surrounding base-rate
		// samples are also zero. To keep the per-sample-equality test
		// deterministic we embed long zero runs around the probed frames.
		const FRAMES = TEST_SAMPLE_RATE * 4;
		const input = makeSynthetic(FRAMES, TEST_SAMPLE_RATE, 41);

		// Embed a 1024-sample silence run starting at probe positions.
		// Long enough that the biquad anti-alias filter's 16-tap response
		// settles to silence in the middle of the run.
		const silenceProbeStarts = [Math.floor(FRAMES / 3), Math.floor(FRAMES / 2), Math.floor((2 * FRAMES) / 3)];

		for (const start of silenceProbeStarts) {
			for (let offset = 0; offset < 1024; offset++) {
				input[start + offset] = 0;
			}
		}

		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target, floor: -60 });
		const outputChannel = output[0] ?? new Float32Array(0);

		expect(outputChannel.length).toBe(input.length);

		// Probe sub-floor samples in the middle of each silence run
		// (well past the 16-tap biquad settling). They must be
		// bit-identical zero out.
		for (const start of silenceProbeStarts) {
			const probe = start + 512;

			expect(input[probe]).toBe(0);
			expect(outputChannel[probe]).toBe(0);
		}

		// Body samples should differ from input on at least some frames
		// (proves the LUT actually applied — the gate didn't spuriously
		// pass everything through).
		let differingBodySamples = 0;

		for (let index = 0; index < FRAMES; index++) {
			if ((input[index] ?? 0) !== 0 && (outputChannel[index] ?? 0) !== (input[index] ?? 0)) {
				differingBodySamples++;
			}
		}

		expect(differingBodySamples).toBeGreaterThan(FRAMES / 4);
	}, TEST_TIMEOUT_MS);

	it("all-silence input (everything below floor) falls through to pass-through", async () => {
		// Source where every sample sits below the -60 dB floor. The
		// floor-gated histogram has zero contributing samples →
		// `bucketMax = 0`, the existing degenerate-histogram bail-out in
		// `_process` trips and `winningLut` stays null → output equals
		// input bit-for-bit.
		const input = new Float32Array(TEST_FRAMES);
		let state = 53;

		for (let index = 0; index < TEST_FRAMES; index++) {
			state = (state * 1664525 + 1013904223) >>> 0;

			// All amplitudes ≤ 1e-5, comfortably below `floorLinear ≈ 1e-3`.
			const sign = (state & 1) === 0 ? 1 : -1;

			input[index] = sign * (state / 0xffffffff) * 1e-5;
		}

		const output = await runStream([input], TEST_SAMPLE_RATE, { target: -16, floor: -60 });
		const outputChannel = output[0] ?? new Float32Array(0);

		expect(outputChannel.length).toBe(input.length);

		// Bit-identical pass-through.
		for (let index = 0; index < input.length; index++) {
			expect(outputChannel[index]).toBe(input[index]);
		}
	}, TEST_TIMEOUT_MS);
});
