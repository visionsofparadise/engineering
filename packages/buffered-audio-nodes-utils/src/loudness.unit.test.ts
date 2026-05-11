import { describe, expect, it } from "vitest";
import { getLraConsideredMinLufs, IntegratedLufsAccumulator, LoudnessAccumulator } from "./loudness";

function generateSine(frequency: number, amplitude: number, sampleRate: number, durationSeconds: number): Float32Array {
	const length = Math.floor(sampleRate * durationSeconds);
	const buffer = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		buffer[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
	}

	return buffer;
}

function measure(channels: ReadonlyArray<Float32Array>, sampleRate: number, channelWeights?: ReadonlyArray<number>): number {
	const accumulator = new IntegratedLufsAccumulator(sampleRate, channels.length, channelWeights);

	accumulator.push(channels, channels[0]?.length ?? 0);

	return accumulator.finalize();
}

describe("IntegratedLufsAccumulator", () => {
	// EBU R128 reference: a 1 kHz sine at -20 dBFS peak (≈ -23 dBFS RMS) measures
	// -23 LUFS integrated under K-weighting. The K-weighting filter contributes
	// ~+0.7 dB of gain at 1 kHz which exactly offsets the -0.691 LUFS_OFFSET
	// plus the small RMS-to-LUFS bookkeeping, landing the measurement at -23.
	it("happy path: 1 kHz sine at -20 dBFS yields integrated LUFS within ±0.3 dB of -23", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		const result = measure([sine], sampleRate);

		expect(result).toBeGreaterThan(-23.3);
		expect(result).toBeLessThan(-22.7);
	});

	it("silence returns -Infinity (everything fails absolute gate)", () => {
		const sampleRate = 48000;
		const silence = new Float32Array(sampleRate * 2);
		const result = measure([silence], sampleRate);

		expect(result).toBe(-Infinity);
	});

	it("relative gate excludes a silent tail: signal+silence ≈ active-region LUFS", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		const silence = new Float32Array(sampleRate * 5);
		const combined = new Float32Array(sine.length + silence.length);

		combined.set(sine, 0);
		combined.set(silence, sine.length);

		const integrated = measure([combined], sampleRate);
		const activeOnly = measure([sine], sampleRate);

		// If the relative gate were not working, the silent tail would
		// drag integrated LUFS far below the active region. With the
		// gate, integrated should sit close to the active-region value.
		expect(integrated).toBeGreaterThan(activeOnly - 1.0);
		expect(integrated).toBeLessThan(activeOnly + 1.0);
	});

	it("two identical channels are +3.01 dB louder than one (BS.1770 sums channel powers)", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		// Use a fresh copy for the second channel because biquad state is
		// per-channel and we want truly equivalent input on each.
		const sineCopy = Float32Array.from(sine);

		const mono = measure([sine], sampleRate);
		const stereo = measure([sine, sineCopy], sampleRate);
		const delta = stereo - mono;

		expect(delta).toBeGreaterThan(3.01 - 0.1);
		expect(delta).toBeLessThan(3.01 + 0.1);
	});

	it("channelWeights [1, 0] on stereo equals mono on channel 0", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		const noise = new Float32Array(sine.length);

		// Fill the silent channel with a small but non-trivial signal so
		// we'd notice if its weight weren't actually zeroed.
		for (let i = 0; i < noise.length; i++) {
			noise[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
		}

		const mono = measure([sine], sampleRate);
		const weighted = measure([sine, noise], sampleRate, [1, 0]);

		expect(Math.abs(weighted - mono)).toBeLessThan(0.01);
	});

	it("44.1 kHz and 48 kHz produce integrated LUFS within ~0.1 dB (prewarp path)", () => {
		const sine48 = generateSine(1000, 0.1, 48000, 5);
		const sine441 = generateSine(1000, 0.1, 44100, 5);

		const lufs48 = measure([sine48], 48000);
		const lufs441 = measure([sine441], 44100);

		expect(Math.abs(lufs48 - lufs441)).toBeLessThan(0.1);
	});

	// Streaming-equivalence: feeding the same signal through the
	// accumulator in arbitrary chunk sizes must produce the same number
	// (within float round-off) as a single big push. Catches biquad-state
	// drift across push() boundaries and off-by-one errors in the block-
	// open / block-close accounting.
	it("streaming in 4096-frame chunks matches one-shot to within 1e-6 dB", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		const oneShot = measure([sine], sampleRate);

		const accumulator = new IntegratedLufsAccumulator(sampleRate, 1);
		const chunkFrames = 4096;

		for (let offset = 0; offset < sine.length; offset += chunkFrames) {
			const frames = Math.min(chunkFrames, sine.length - offset);
			const slice = sine.subarray(offset, offset + frames);

			accumulator.push([slice], frames);
		}

		const streamed = accumulator.finalize();

		expect(Math.abs(streamed - oneShot)).toBeLessThan(1e-6);
	});

	it("awkward 7777-frame chunks (misaligned to both blockSize and blockStep) match one-shot", () => {
		// blockSize = 19200 frames @ 48 kHz, blockStep = 4800 frames. 7777
		// is coprime to both, so chunk boundaries land at every position
		// inside the block grid across the run — exercising every off-by-
		// one path in the open/close accounting.
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		const oneShot = measure([sine], sampleRate);

		const accumulator = new IntegratedLufsAccumulator(sampleRate, 1);
		const chunkFrames = 7777;

		for (let offset = 0; offset < sine.length; offset += chunkFrames) {
			const frames = Math.min(chunkFrames, sine.length - offset);
			const slice = sine.subarray(offset, offset + frames);

			accumulator.push([slice], frames);
		}

		const streamed = accumulator.finalize();

		expect(Math.abs(streamed - oneShot)).toBeLessThan(1e-6);
	});

	it("last partial chunk (N-2 then 2 frames) matches one-shot", () => {
		// Catches off-by-one in `samplesProcessed` when a tiny tail chunk
		// closes the final block(s).
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		const oneShot = measure([sine], sampleRate);

		const accumulator = new IntegratedLufsAccumulator(sampleRate, 1);
		const headFrames = sine.length - 2;
		const head = sine.subarray(0, headFrames);
		const tail = sine.subarray(headFrames);

		accumulator.push([head], headFrames);
		accumulator.push([tail], 2);

		const streamed = accumulator.finalize();

		expect(Math.abs(streamed - oneShot)).toBeLessThan(1e-6);
	});
});

describe("getLraConsideredMinLufs", () => {
	it("empty input returns +Infinity", () => {
		expect(getLraConsideredMinLufs([])).toBe(Number.POSITIVE_INFINITY);
	});

	it("all blocks at -80 LUFS (below absolute gate) return +Infinity", () => {
		const shortTerm = [-80, -80, -80, -80];

		expect(getLraConsideredMinLufs(shortTerm)).toBe(Number.POSITIVE_INFINITY);
	});

	it("single block at -30 LUFS survives both gates and is returned as the min", () => {
		// Absolute gate: -30 > -70 ✓. Linear-energy mean of one block is
		// itself, so 10*log10(10^-3) = -30; relative threshold = -50;
		// the block (-30) is > -50 → survives → min = -30.
		expect(getLraConsideredMinLufs([-30])).toBe(-30);
	});

	it("blocks [-20, -25, -30, -45, -60] yield min(considered) = -45", () => {
		// Absolute gate: all five > -70, all survive.
		// Linear-energy mean:
		//   sum = 10^-2 + 10^-2.5 + 10^-3 + 10^-4.5 + 10^-6
		//       ≈ 0.01 + 0.0031623 + 0.001 + 0.0000316 + 0.000001
		//       ≈ 0.01419492
		//   mean ≈ 0.002838984
		//   10*log10(mean) ≈ -25.466
		//   relativeThreshold ≈ -25.466 + (-20) = -45.466
		// Strict `>` comparison (matches computeLraFromShortTerm):
		//   -20, -25, -30, -45 all > -45.466 → survive.
		//   -60 < -45.466 → gated.
		// min(considered) = -45.
		expect(getLraConsideredMinLufs([-20, -25, -30, -45, -60])).toBe(-45);
	});

	it("blocks [-90, -85, -25] yield -25 (absolute gate drops -90 and -85)", () => {
		// -90 and -85 are both < -70 → fail absolute gate. Only -25 survives.
		// Single-survivor relative threshold = -25 + (-20) = -45;
		// -25 > -45 → survives both gates → min = -25.
		expect(getLraConsideredMinLufs([-90, -85, -25])).toBe(-25);
	});

	it("agreement with computeLraFromShortTerm: on a non-trivial fixture where LRA > 0, returns a finite value within the absolute gate", () => {
		// Build a synthetic short-term sequence by running LoudnessAccumulator
		// on two concatenated sine tones at different amplitudes — this
		// produces multiple short-term blocks spanning a real LRA.
		const sampleRate = 48000;
		const loudSine = generateSine(1000, 0.1, sampleRate, 6); // ~-23 LUFS
		const quietSine = generateSine(1000, 0.01, sampleRate, 6); // ~-43 LUFS
		const combined = new Float32Array(loudSine.length + quietSine.length);

		combined.set(loudSine, 0);
		combined.set(quietSine, loudSine.length);

		const accumulator = new LoudnessAccumulator(sampleRate, 1);

		accumulator.push([combined], combined.length);

		const result = accumulator.finalize();

		// Sanity check on the fixture itself: a real LRA must be positive
		// for the agreement check to be meaningful.
		expect(result.range).toBeGreaterThan(0);
		expect(result.shortTerm.length).toBeGreaterThan(0);

		const consideredMin = getLraConsideredMinLufs(result.shortTerm);

		// Helper must return a finite value (the considered set is non-empty
		// when LRA is computable) within the BS.1770 absolute gate.
		expect(Number.isFinite(consideredMin)).toBe(true);
		expect(consideredMin).toBeGreaterThan(-70);
		// And the helper's min must lie at or below every short-term block
		// in the considered set — i.e. ≤ the maximum considered value, which
		// is bounded above by the maximum short-term block.
		expect(consideredMin).toBeLessThanOrEqual(Math.max(...result.shortTerm));
	});
});
