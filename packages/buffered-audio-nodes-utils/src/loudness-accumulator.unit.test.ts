import { describe, expect, it } from "vitest";
import { IntegratedLufsAccumulator, LoudnessAccumulator } from "./loudness";

function generateSine(frequency: number, amplitude: number, sampleRate: number, durationSeconds: number): Float32Array {
	const length = Math.floor(sampleRate * durationSeconds);
	const buffer = new Float32Array(length);

	for (let i = 0; i < length; i++) {
		buffer[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
	}

	return buffer;
}

describe("LoudnessAccumulator", () => {
	it("silence yields integrated -Infinity, range 0, and short-term/momentary at the dB floor", () => {
		// 4 s of silence: long enough for at least one closed 3 s short-term
		// block. integrated must -Infinity (every block fails the absolute
		// gate); range must be 0 (fewer than two short-term survivors); the
		// momentary/shortTerm arrays themselves carry the LUFS_OFFSET +
		// 10*log10(1e-10) = -100.691 floor for each closed block (ungated).
		const sampleRate = 48000;
		const silence = new Float32Array(sampleRate * 4);

		const accumulator = new LoudnessAccumulator(sampleRate, 1);

		accumulator.push([silence], silence.length);

		const result = accumulator.finalize();

		expect(result.integrated).toBe(-Infinity);
		expect(result.range).toBe(0);
		expect(result.momentary.length).toBeGreaterThan(0);
		expect(result.shortTerm.length).toBeGreaterThan(0);

		for (let i = 0; i < result.momentary.length; i++) {
			expect(result.momentary[i]).toBeCloseTo(-100.691, 3);
		}

		for (let i = 0; i < result.shortTerm.length; i++) {
			expect(result.shortTerm[i]).toBeCloseTo(-100.691, 3);
		}
	});

	it("integrated cross-checks IntegratedLufsAccumulator on a 1 kHz sine within 1e-9 relative", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);

		const reference = new IntegratedLufsAccumulator(sampleRate, 1);

		reference.push([sine], sine.length);

		const referenceIntegrated = reference.finalize();

		const accumulator = new LoudnessAccumulator(sampleRate, 1);

		accumulator.push([sine], sine.length);

		const result = accumulator.finalize();

		// Both consume the same K-weighted squared sums and apply the same
		// 400 ms / 100 ms BS.1770 gating helper, so the integrated value
		// must match to within float round-off.
		expect(Math.abs(result.integrated - referenceIntegrated) / Math.abs(referenceIntegrated)).toBeLessThan(1e-9);

		// 5 s sine. blockStep = 4800 frames @ 48 kHz.
		// Momentary blocks: floor((5*48000 - 0.4*48000) / 4800) + 1 = 47.
		// Short-term blocks: floor((5*48000 - 3*48000) / 4800) + 1 = 21.
		expect(result.momentary.length).toBe(47);
		expect(result.shortTerm.length).toBe(21);

		// Sanity: a steady-state sine has all short-term values close to
		// the integrated value, so the LRA spread is small.
		expect(result.range).toBeGreaterThanOrEqual(0);
		expect(result.range).toBeLessThan(0.5);
	});

	it("chunked push parity: same final result for one push vs many small chunks", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);

		const oneShot = new LoudnessAccumulator(sampleRate, 1);

		oneShot.push([sine], sine.length);

		const oneShotResult = oneShot.finalize();

		const chunked = new LoudnessAccumulator(sampleRate, 1);
		const chunkFrames = 7777;

		for (let offset = 0; offset < sine.length; offset += chunkFrames) {
			const frames = Math.min(chunkFrames, sine.length - offset);
			const slice = sine.subarray(offset, offset + frames);

			chunked.push([slice], frames);
		}

		const chunkedResult = chunked.finalize();

		expect(Math.abs(chunkedResult.integrated - oneShotResult.integrated)).toBeLessThan(1e-6);
		expect(chunkedResult.momentary.length).toBe(oneShotResult.momentary.length);
		expect(chunkedResult.shortTerm.length).toBe(oneShotResult.shortTerm.length);

		for (let i = 0; i < oneShotResult.momentary.length; i++) {
			expect(Math.abs((chunkedResult.momentary[i] ?? 0) - (oneShotResult.momentary[i] ?? 0))).toBeLessThan(1e-6);
		}

		for (let i = 0; i < oneShotResult.shortTerm.length; i++) {
			expect(Math.abs((chunkedResult.shortTerm[i] ?? 0) - (oneShotResult.shortTerm[i] ?? 0))).toBeLessThan(1e-6);
		}

		expect(Math.abs(chunkedResult.range - oneShotResult.range)).toBeLessThan(1e-6);
	});

	it("two identical channels are +3.01 dB louder than one (BS.1770 sums channel powers)", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);
		// Fresh copy because biquad state is per-channel.
		const sineCopy = Float32Array.from(sine);

		const mono = new LoudnessAccumulator(sampleRate, 1);

		mono.push([sine], sine.length);

		const monoIntegrated = mono.finalize().integrated;

		const stereo = new LoudnessAccumulator(sampleRate, 2);

		stereo.push([sine, sineCopy], sine.length);

		const stereoIntegrated = stereo.finalize().integrated;

		const delta = stereoIntegrated - monoIntegrated;

		expect(delta).toBeGreaterThan(3.01 - 0.1);
		expect(delta).toBeLessThan(3.01 + 0.1);
	});

	it("finalize is idempotent: subsequent calls return the same cached result reference", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 5);

		const accumulator = new LoudnessAccumulator(sampleRate, 1);

		accumulator.push([sine], sine.length);

		const first = accumulator.finalize();
		const second = accumulator.finalize();

		// Same reference — caches the result object so callers can rely on
		// repeated reads being free.
		expect(second).toBe(first);
		expect(second.momentary).toBe(first.momentary);
		expect(second.shortTerm).toBe(first.shortTerm);
	});

	it("push after finalize throws", () => {
		const sampleRate = 48000;
		const sine = generateSine(1000, 0.1, sampleRate, 1);

		const accumulator = new LoudnessAccumulator(sampleRate, 1);

		accumulator.push([sine], sine.length);
		accumulator.finalize();

		expect(() => {
			accumulator.push([sine], sine.length);
		}).toThrow(/push.*after finalize/);
	});
});
