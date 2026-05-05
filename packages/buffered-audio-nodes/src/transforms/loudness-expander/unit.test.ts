/* eslint-disable no-console -- the node logs an iteration summary by design; tests run with vitest, console output is fine in CI. */
import { describe, expect, it } from "vitest";
import { IntegratedLufsAccumulator } from "@e9g/buffered-audio-nodes-utils";
import { type AudioChunk } from "@e9g/buffered-audio-nodes-core";
import { loudnessExpander, LoudnessExpanderStream, schema } from ".";

const TEST_SAMPLE_RATE = 48_000;
const TEST_FRAMES = TEST_SAMPLE_RATE * 4; // 4 s — long enough for BS.1770 gating.

function measureLufs(channels: ReadonlyArray<Float32Array>, sampleRate: number): number {
	const accumulator = new IntegratedLufsAccumulator(sampleRate, channels.length);

	accumulator.push(channels, channels[0]?.length ?? 0);

	return accumulator.finalize();
}

/**
 * Deterministic synthetic source — identical to the shaper's
 * `makeSynthetic`. Low-frequency sine + small high-frequency sine + LCG-
 * seeded white noise; broadband body lands in a sane voice/podcast LUFS
 * range at amplitude 0.1 (peak ≈ 0.12).
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

interface ExpanderRunOptions {
	target: number;
	floor: number;
	pivot: number;
	tension?: number;
	smoothing?: number;
	tolerance?: number;
	maxAttempts?: number;
}

/**
 * Drive the LoudnessExpanderStream end-to-end as a single chunk.
 * Mirrors the shaper's `runStream` pattern.
 */
async function runStream(channels: ReadonlyArray<Float32Array>, sampleRate: number, properties: ExpanderRunOptions): Promise<Array<Float32Array>> {
	const channelCount = channels.length;
	const stream = new LoudnessExpanderStream({
		target: properties.target,
		floor: properties.floor,
		pivot: properties.pivot,
		tension: properties.tension ?? 1,
		smoothing: properties.smoothing ?? 1,
		tolerance: properties.tolerance ?? 0.5,
		maxAttempts: properties.maxAttempts ?? 10,
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
 * Drive the LoudnessExpanderStream by writing the source as multiple
 * chunks of `chunkFrames` each. The winning gain envelope is shared
 * across all chunks and indexed by absolute `chunk.offset`, so the
 * chunked output must be byte-equivalent to the single-chunk output.
 */
async function runStreamChunked(channels: ReadonlyArray<Float32Array>, sampleRate: number, properties: ExpanderRunOptions, chunkFrames: number): Promise<Array<Float32Array>> {
	const channelCount = channels.length;
	const stream = new LoudnessExpanderStream({
		target: properties.target,
		floor: properties.floor,
		pivot: properties.pivot,
		tension: properties.tension ?? 1,
		smoothing: properties.smoothing ?? 1,
		tolerance: properties.tolerance ?? 0.5,
		maxAttempts: properties.maxAttempts ?? 10,
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

describe("LoudnessExpander schema", () => {
	const validAnchors = { floor: -50, pivot: -22 };

	it("applies defaults for non-required fields", () => {
		const parsed = schema.parse(validAnchors);

		expect(parsed.target).toBe(-16);
		expect(parsed.tension).toBe(1);
		expect(parsed.smoothing).toBe(1);
		expect(parsed.tolerance).toBe(0.5);
		expect(parsed.maxAttempts).toBe(10);
	});

	it("accepts explicit valid values", () => {
		const parsed = schema.parse({ target: -10, floor: -55, pivot: -18, tension: 2, smoothing: 25, tolerance: 0.1, maxAttempts: 20 });

		expect(parsed.target).toBe(-10);
		expect(parsed.floor).toBe(-55);
		expect(parsed.pivot).toBe(-18);
		expect(parsed.tension).toBe(2);
		expect(parsed.smoothing).toBe(25);
		expect(parsed.tolerance).toBeCloseTo(0.1, 10);
		expect(parsed.maxAttempts).toBe(20);
	});

	it("requires floor and pivot (no defaults)", () => {
		expect(() => schema.parse({})).toThrow();
		expect(() => schema.parse({ floor: -55 })).toThrow();
		expect(() => schema.parse({ pivot: -22 })).toThrow();
	});

	it("rejects floor >= pivot", () => {
		expect(() => schema.parse({ floor: -22, pivot: -22 })).toThrow();
		expect(() => schema.parse({ floor: -10, pivot: -22 })).toThrow();
	});

	it("rejects floor / pivot >= 0", () => {
		expect(() => schema.parse({ floor: 0, pivot: -10 })).toThrow();
		expect(() => schema.parse({ floor: -50, pivot: 0 })).toThrow();
		expect(() => schema.parse({ floor: 1, pivot: -10 })).toThrow();
		expect(() => schema.parse({ floor: -50, pivot: 5 })).toThrow();
	});

	it("rejects tension <= 0", () => {
		expect(() => schema.parse({ ...validAnchors, tension: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, tension: -1 })).toThrow();
	});

	it("rejects smoothing outside [0.01, 200]", () => {
		expect(() => schema.parse({ ...validAnchors, smoothing: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, smoothing: 0.001 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, smoothing: 250 })).toThrow();
	});

	it("rejects tolerance <= 0 and non-positive integer maxAttempts", () => {
		expect(() => schema.parse({ ...validAnchors, tolerance: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, tolerance: -0.1 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, maxAttempts: 0 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, maxAttempts: 1.5 })).toThrow();
		expect(() => schema.parse({ ...validAnchors, maxAttempts: -1 })).toThrow();
	});

	it("loudnessExpander() factory parses options through the schema", () => {
		const node = loudnessExpander({ target: -12, floor: -50, pivot: -22, tension: 2, smoothing: 5, tolerance: 0.2, maxAttempts: 15 });

		expect(node.properties.target).toBe(-12);
		expect(node.properties.floor).toBe(-50);
		expect(node.properties.pivot).toBe(-22);
		expect(node.properties.tension).toBe(2);
		expect(node.properties.smoothing).toBe(5);
		expect(node.properties.tolerance).toBeCloseTo(0.2, 10);
		expect(node.properties.maxAttempts).toBe(15);
	});
});

describe("LoudnessExpander end-to-end", () => {
	const TEST_TIMEOUT_MS = 120_000;

	// Anchors for the synthetic source: amplitude ~0.1 → body ≈ -25 dBFS,
	// peak ≈ 0.12. `floor = -50` (≈ 3.16e-3 lin) sits well below the
	// noise content; `pivot = -22` (≈ 7.94e-2 lin) sits at the body's
	// upper edge so most of the active signal gets the rising-side ramp.
	const synthAnchors = { floor: -50, pivot: -22 };

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

	it("processes a stereo source with each channel intact (linked detection)", async () => {
		const left = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 11);
		const right = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 23);
		const sourceLufs = measureLufs([left, right], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;
		const output = await runStream([left, right], TEST_SAMPLE_RATE, { target, ...synthAnchors });

		expect(output).toHaveLength(2);
		expect(output[0]?.length).toBe(left.length);
		expect(output[1]?.length).toBe(right.length);

		// Combined-output integrated LUFS lands within the same ~1 dB
		// end-to-end tolerance the iteration pursues.
		const measured = measureLufs([output[0] ?? new Float32Array(0), output[1] ?? new Float32Array(0)], TEST_SAMPLE_RATE);

		expect(Math.abs(measured - target)).toBeLessThan(1.0);

		// Distinct seeds in → distinct outputs out (channels are scaled
		// by the same envelope but the input samples differ).
		const leftOut = output[0] ?? new Float32Array(0);
		const rightOut = output[1] ?? new Float32Array(0);
		let differingSamples = 0;

		for (let index = 0; index < leftOut.length; index++) {
			if ((leftOut[index] ?? 0) !== (rightOut[index] ?? 0)) differingSamples++;
		}

		expect(differingSamples).toBeGreaterThan(leftOut.length / 2);
	}, TEST_TIMEOUT_MS);

	it("multi-chunk input matches single-chunk input (envelope indexed by absolute offset)", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 7);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);
		const target = Math.round((sourceLufs + 3) * 10) / 10;

		const single = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors });
		const chunked = await runStreamChunked([input], TEST_SAMPLE_RATE, { target, ...synthAnchors }, 4096);

		const singleChannel = single[0] ?? new Float32Array(0);
		const chunkedChannel = chunked[0] ?? new Float32Array(0);

		expect(singleChannel.length).toBe(input.length);
		expect(chunkedChannel.length).toBe(input.length);

		// The winning smoothed envelope is computed once per stream over
		// the whole source and indexed by absolute `chunk.offset` at
		// apply time. Multi-chunk runs must produce identical bytes —
		// any drift indicates an offset wiring bug.
		let maxError = 0;

		for (let index = 0; index < singleChannel.length; index++) {
			const diff = Math.abs((singleChannel[index] ?? 0) - (chunkedChannel[index] ?? 0));

			if (diff > maxError) maxError = diff;
		}

		expect(maxError).toBe(0);
	}, TEST_TIMEOUT_MS);

	it("non-default smoothing changes the output", async () => {
		const input = makeSynthetic(TEST_FRAMES, TEST_SAMPLE_RATE, 31);
		const sourceLufs = measureLufs([input], TEST_SAMPLE_RATE);

		if (!Number.isFinite(sourceLufs)) return;

		const target = Math.round((sourceLufs + 3) * 10) / 10;

		// Two runs identical except for the smoothing time constant. At
		// 1 ms the gain envelope tracks the detection signal closely; at
		// 50 ms the envelope rides program dynamics far more slowly,
		// producing measurably different per-sample multipliers.
		const tight = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors, smoothing: 1 });
		const loose = await runStream([input], TEST_SAMPLE_RATE, { target, ...synthAnchors, smoothing: 50 });

		const tightChannel = tight[0] ?? new Float32Array(0);
		const looseChannel = loose[0] ?? new Float32Array(0);

		expect(tightChannel.length).toBe(input.length);
		expect(looseChannel.length).toBe(input.length);

		let differingSamples = 0;

		for (let index = 0; index < input.length; index++) {
			if (Math.abs((tightChannel[index] ?? 0) - (looseChannel[index] ?? 0)) > 1e-5) differingSamples++;
		}

		expect(differingSamples).toBeGreaterThan(0);
	}, TEST_TIMEOUT_MS);
});
