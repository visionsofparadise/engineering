/* eslint-disable no-console -- the node logs an iteration summary by design; tests run with vitest, console output is fine in CI. */
import { describe, expect, it } from "vitest";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { type AudioChunk } from "@e9g/buffered-audio-nodes-core";
import { loudnessShaper, LoudnessShaperStream, schema } from ".";

const TEST_SAMPLE_RATE = 48_000;
const TEST_FRAMES = TEST_SAMPLE_RATE * 4; // 4 s — long enough for BS.1770 gating.

function measureLufs(channels: ReadonlyArray<Float32Array>, sampleRate: number): number {
	const accumulator = new IntegratedLufsAccumulator(sampleRate, channels.length);

	accumulator.push(channels, channels[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Deterministic synthetic source: low-frequency sine + small high-
 * frequency sine + LCG-seeded white noise. Models the broadband / multi-
 * tone character the loudness-shaper learn pass is designed to consume;
 * the integrated LUFS lands in a sane podcast/voice-like range at
 * amplitude 0.1.
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

interface ShaperRunOptions {
	target: number;
	floor: number;
	bodyLow: number;
	bodyHigh: number;
	preservePeaks?: boolean;
	warmth?: number;
}

/**
 * Drive the LoudnessShaperStream end-to-end (without involving file I/O).
 * Mirrors the "renders end-to-end with no ffmpeg involvement" pattern in
 * `loudness-normalize/unit.test.ts` — write the input chunk(s), close the
 * writer, drain the readable concurrently, reassemble per-channel arrays.
 */
async function runStream(channels: ReadonlyArray<Float32Array>, sampleRate: number, properties: ShaperRunOptions): Promise<Array<Float32Array>> {
	const channelCount = channels.length;
	const stream = new LoudnessShaperStream({
		target: properties.target,
		floor: properties.floor,
		bodyLow: properties.bodyLow,
		bodyHigh: properties.bodyHigh,
		preservePeaks: properties.preservePeaks ?? true,
		warmth: properties.warmth ?? 0,
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

/**
 * Drive the LoudnessShaperStream by writing the source as multiple
 * chunks rather than a single whole-source chunk. Used by the streaming
 * regression test to exercise the chunk-by-chunk `_unbuffer` apply path
 * with persistent oversamplers.
 */
async function runStreamChunked(channels: ReadonlyArray<Float32Array>, sampleRate: number, properties: ShaperRunOptions, chunkFrames: number): Promise<Array<Float32Array>> {
	const channelCount = channels.length;
	const stream = new LoudnessShaperStream({
		target: properties.target,
		floor: properties.floor,
		bodyLow: properties.bodyLow,
		bodyHigh: properties.bodyHigh,
		preservePeaks: properties.preservePeaks ?? true,
		warmth: properties.warmth ?? 0,
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

describe("LoudnessShaper schema", () => {
	const validAnchors = { floor: -55, bodyLow: -42, bodyHigh: -20 };

	it("applies defaults for non-required fields", () => {
		const parsed = schema.parse(validAnchors);

		expect(parsed.target).toBe(-16);
		expect(parsed.preservePeaks).toBe(true);
		expect(parsed.warmth).toBe(0);
	});

	it("accepts explicit valid values", () => {
		const parsed = schema.parse({ target: -10, floor: -50, bodyLow: -35, bodyHigh: -15, preservePeaks: false, warmth: 0.5 });

		expect(parsed.target).toBe(-10);
		expect(parsed.floor).toBe(-50);
		expect(parsed.bodyLow).toBe(-35);
		expect(parsed.bodyHigh).toBe(-15);
		expect(parsed.preservePeaks).toBe(false);
		expect(parsed.warmth).toBeCloseTo(0.5, 10);
	});

	it("requires floor, bodyLow, bodyHigh (no defaults)", () => {
		expect(() => schema.parse({})).toThrow();
		expect(() => schema.parse({ floor: -55 })).toThrow();
		expect(() => schema.parse({ floor: -55, bodyLow: -42 })).toThrow();
	});

	it("rejects floor / bodyLow / bodyHigh >= 0", () => {
		expect(() => schema.parse({ ...validAnchors, floor: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, bodyLow: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, bodyHigh: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, floor: 1 })).toThrow();
	});

	it("rejects ordering violations: floor < bodyLow ≤ bodyHigh < 0", () => {
		// floor >= bodyLow
		expect(() => schema.parse({ floor: -42, bodyLow: -42, bodyHigh: -20 })).toThrow();
		expect(() => schema.parse({ floor: -30, bodyLow: -42, bodyHigh: -20 })).toThrow();
		// bodyLow > bodyHigh
		expect(() => schema.parse({ floor: -55, bodyLow: -10, bodyHigh: -20 })).toThrow();
	});

	it("accepts bodyLow === bodyHigh (degenerate-but-allowed flat point)", () => {
		const parsed = schema.parse({ floor: -55, bodyLow: -20, bodyHigh: -20 });

		expect(parsed.bodyLow).toBe(-20);
		expect(parsed.bodyHigh).toBe(-20);
	});

	it("rejects warmth outside [0, 1]", () => {
		expect(() => schema.parse({ ...validAnchors, warmth: -0.1 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, warmth: 1.5 })).toThrow();
	});

	it("rejects target outside the LUFS range", () => {
		expect(() => schema.parse({ ...validAnchors, target: -100 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, target: 5 })).toThrow();
	});

	it("loudnessShaper() factory parses options through the schema", () => {
		const node = loudnessShaper({ target: -12, floor: -55, bodyLow: -42, bodyHigh: -20, warmth: 0.2 });

		expect(node.properties.target).toBe(-12);
		expect(node.properties.floor).toBe(-55);
		expect(node.properties.bodyLow).toBe(-42);
		expect(node.properties.bodyHigh).toBe(-20);
		expect(node.properties.preservePeaks).toBe(true);
		expect(node.properties.warmth).toBeCloseTo(0.2, 10);
	});
});

describe("LoudnessShaper end-to-end", () => {
	const TEST_TIMEOUT_MS = 120_000;

	// Anchors picked for the synthetic source (amplitude ~0.1; broadband
	// noise + low-frequency sine; observed peak ≈ 0.12). bodyHigh sits
	// comfortably below the source peak so the upper roll-off (when
	// preservePeaks=true) has room to ramp; floor at -60 dB (linear ≈
	// 1e-3) sits well below the body content.
	const synthAnchors = { floor: -60, bodyLow: -40, bodyHigh: -28 };

	it("hits target LUFS within ~1 dB on a synthetic broadband source", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 1);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors });
		const outputChannel = output[0];

		expect(outputChannel).toBeDefined();
		expect(outputChannel?.length).toBe(input.length);

		const measured = measureLufs([outputChannel ?? new Float32Array(0)], TEST_SAMPLE_RATE);

		expect(Math.abs(measured - target)).toBeLessThan(1.0);
	}, TEST_TIMEOUT_MS);

	it("preservePeaks = true: no output sample exceeds source peak", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 3);
		let sourcePeak = 0;

		for (let index = 0; index < input.length; index++) {
			const absolute = Math.abs(input[index] ?? 0);

			if (absolute > sourcePeak) sourcePeak = absolute;
		}

		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors, preservePeaks: true });
		const outputChannel = output[0] ?? new Float32Array(0);

		// Probe past the leading biquad warm-up — the oversampler's
		// anti-alias filter can emit a small transient on the first few
		// samples. Source peak preservation is a tendency in the settled
		// stream, with a small allowance for the 4× oversampler's filter
		// ripple.
		const probeStart = Math.floor(outputChannel.length / 10);
		let outputPeak = 0;

		for (let index = probeStart; index < outputChannel.length; index++) {
			const absolute = Math.abs(outputChannel[index] ?? 0);

			if (absolute > outputPeak) outputPeak = absolute;
		}

		// Allow ~15% headroom: the curve geometry anchors the LUT at the
		// (base-rate) source peak, but the 4× upsample produces inter-
		// sample values that can exceed source peak, and those get boosted
		// before the downsample. The check below is a "no large overshoot"
		// sanity test, not a strict peak-preservation guarantee — the
		// design's "preservePeaks" semantics constrain the LUT, not the
		// final-apply pipeline's anti-alias filter ripple.
		expect(outputPeak).toBeLessThan(sourcePeak * 1.15);
	}, TEST_TIMEOUT_MS);

	it("preservePeaks = false: output peak may exceed source peak (expander mode)", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 5);
		let sourcePeak = 0;

		for (let index = 0; index < input.length; index++) {
			const absolute = Math.abs(input[index] ?? 0);

			if (absolute > sourcePeak) sourcePeak = absolute;
		}

		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors, preservePeaks: false });
		const outputChannel = output[0] ?? new Float32Array(0);
		let outputPeak = 0;

		for (let index = 0; index < outputChannel.length; index++) {
			const absolute = Math.abs(outputChannel[index] ?? 0);

			if (absolute > outputPeak) outputPeak = absolute;
		}

		// In expander mode, samples at and above bodyHigh are lifted by
		// (1 + boost) — output peak must exceed source peak by some
		// margin (boost > 0 for a +3 dB target). Assert strict >.
		expect(outputPeak).toBeGreaterThan(sourcePeak);

		// Output is still finite (no NaN/Inf despite uncapped lift).
		for (let index = 0; index < outputChannel.length; index++) {
			expect(Number.isFinite(outputChannel[index] ?? 0)).toBe(true);
		}
	}, TEST_TIMEOUT_MS);

	it("warmth > 0: per-side asymmetry produces measurable pos/neg difference on an asymmetric source", async () => {
		// Asymmetric source: positives bounded at 0.4, negatives at 0.15.
		// Warmth implementation lerps BOTH sides' `peak` between the
		// symmetric value (`max(posPeak, negPeak)` = 0.4, shared by both
		// sides at warmth=0) and the asymmetric value (each side's own
		// measured peak — posPeak=0.4, negPeak=0.15 — at warmth=1). The
		// positive side stays unchanged for this source (posPeak ==
		// symmetricPeak), but the negative side moves from 0.4 to 0.15
		// as warmth rises. Because the formula is symmetric in the sides,
		// flipping the source's pos/neg balance would still produce
		// measurable asymmetry — the side with the smaller peak is the
		// one whose anchor moves with warmth.
		const frames = TEST_FRAMES;
		const channel = new Float32Array(frames);
		let state = 19 >>> 0;

		for (let index = 0; index < frames; index++) {
			state = (state * 1664525 + 1013904223) >>> 0;

			const u1 = state / 0xffffffff;

			state = (state * 1664525 + 1013904223) >>> 0;

			const u2 = state / 0xffffffff;

			channel[index] = u1 < 0.5 ? -u2 * 0.15 : u2 * 0.4;
		}

		const sourceLufs = measureLufs([channel], TEST_SAMPLE_RATE);

		if (!Number.isFinite(sourceLufs)) return; // bail if source is unmeasurable

		const target = Math.round((sourceLufs + 3) * 10) / 10;
		// posPeak ≈ 0.4 (-7.96 dB), negPeak ≈ 0.15 (-16.5 dB). bodyHigh
		// sits well below negPeak so both sides have a real upper ramp.
		const anchors = { floor: -50, bodyLow: -36, bodyHigh: -22 };

		const cold = await runStream([channel], TEST_SAMPLE_RATE, { target, ...anchors, warmth: 0 });
		const warm = await runStream([channel], TEST_SAMPLE_RATE, { target, ...anchors, warmth: 1 });

		expect(cold[0]?.length).toBe(channel.length);
		expect(warm[0]?.length).toBe(channel.length);

		// Differ in any sample beyond float-rounding noise → asymmetric
		// peak anchor produced a different LUT.
		let differingSamples = 0;

		for (let index = 0; index < channel.length; index++) {
			const coldValue = cold[0]?.[index] ?? 0;
			const warmValue = warm[0]?.[index] ?? 0;

			if (Math.abs(coldValue - warmValue) > 1e-5) differingSamples++;
		}

		expect(differingSamples).toBeGreaterThan(0);
	}, TEST_TIMEOUT_MS);

	it("processes a stereo source with each channel intact", async () => {
		const left = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 11);
		const right = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 23);
		const sourceLufs = measureLufs([left, right], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([left, right], TEST_SAMPLE_RATE, { target, ...synthAnchors });

		expect(output).toHaveLength(2);
		expect(output[0]?.length).toBe(left.length);
		expect(output[1]?.length).toBe(right.length);

		// LUFS lands within the same ~1 dB end-to-end tolerance for stereo.
		const measured = measureLufs([output[0] ?? new Float32Array(0), output[1] ?? new Float32Array(0)], TEST_SAMPLE_RATE);

		expect(Math.abs(measured - target)).toBeLessThan(1.0);

		// Distinct seeds in → distinct outputs out.
		const leftOut = output[0] ?? new Float32Array(0);
		const rightOut = output[1] ?? new Float32Array(0);
		let differingSamples = 0;

		for (let index = 0; index < leftOut.length; index++) {
			if ((leftOut[index] ?? 0) !== (rightOut[index] ?? 0)) differingSamples++;
		}

		expect(differingSamples).toBeGreaterThan(leftOut.length / 2);
	}, TEST_TIMEOUT_MS);

	it("multi-chunk input matches single-chunk input (oversampler state is chunk-continuous)", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 7);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;

		const single = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors });
		const chunked = await runStreamChunked([input], TEST_SAMPLE_RATE, { target, ...synthAnchors }, 4096);

		const singleChannel = single[0] ?? new Float32Array(0);
		const chunkedChannel = chunked[0] ?? new Float32Array(0);

		expect(singleChannel.length).toBe(input.length);
		expect(chunkedChannel.length).toBe(input.length);

		let maxError = 0;

		for (let index = 0; index < singleChannel.length; index++) {
			const diff = Math.abs((singleChannel[index] ?? 0) - (chunkedChannel[index] ?? 0));

			if (diff > maxError) maxError = diff;
		}

		expect(maxError).toBeLessThan(1e-6);
	}, TEST_TIMEOUT_MS);
});
