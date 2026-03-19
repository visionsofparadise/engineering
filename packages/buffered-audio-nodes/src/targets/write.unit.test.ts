import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { read } from "../sources/read";
import { write } from "./write";
import { readToBuffer, readWavSamples } from "../utils/read-to-buffer";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";

const testVoice = join(import.meta.dirname, "../utils/test-voice.wav");

describe("WriteModule", () => {
	it("round-trips a WAV file with correct duration and sample rate", async () => {
		const original = await readWavSamples(testVoice);
		const tempOut = join(tmpdir(), `acm-write-rt-${randomBytes(8).toString("hex")}.wav`);

		try {
			const source = read(testVoice);
			const target = write(tempOut, { bitDepth: "32f" });
			source.to(target);
			await source.render();

			const result = await readWavSamples(tempOut);

			expect(result.sampleRate).toBe(original.sampleRate);
			expect(result.durationFrames).toBe(original.durationFrames);
			expect(result.channels).toBe(original.channels);

			// Verify sample data integrity — compare a segment
			const compareLength = Math.min(1000, original.durationFrames);
			for (let ch = 0; ch < original.channels; ch++) {
				const origCh = original.samples[ch]!;
				const resultCh = result.samples[ch]!;
				for (let i = 0; i < compareLength; i++) {
					expect(resultCh[i]).toBeCloseTo(origCh[i]!, 4);
				}
			}
		} finally {
			await unlink(tempOut).catch(() => undefined);
		}
	}, 240_000);

	it("writes 16-bit WAV and produces readable output", async () => {
		const original = await readWavSamples(testVoice);
		const tempOut = join(tmpdir(), `acm-write-16-${randomBytes(8).toString("hex")}.wav`);

		try {
			const source = read(testVoice);
			const target = write(tempOut, { bitDepth: "16" });
			source.to(target);
			await source.render();

			const result = await readWavSamples(tempOut);

			expect(result.sampleRate).toBe(original.sampleRate);
			expect(result.durationFrames).toBe(original.durationFrames);
			expect(result.channels).toBe(original.channels);

			// 16-bit quantization means less precision, but duration and shape should match
			const origCh0 = original.samples[0]!;
			const resultCh0 = result.samples[0]!;
			const compareLength = Math.min(1000, original.durationFrames);

			for (let i = 0; i < compareLength; i++) {
				// 16-bit has ~1/32768 precision
				expect(resultCh0[i]).toBeCloseTo(origCh0[i]!, 3);
			}
		} finally {
			await unlink(tempOut).catch(() => undefined);
		}
	}, 240_000);

	it("writes 32f WAV and produces readable output", async () => {
		const original = await readWavSamples(testVoice);
		const tempOut = join(tmpdir(), `acm-write-32f-${randomBytes(8).toString("hex")}.wav`);

		try {
			const source = read(testVoice);
			const target = write(tempOut, { bitDepth: "32f" });
			source.to(target);
			await source.render();

			const result = await readWavSamples(tempOut);

			expect(result.sampleRate).toBe(original.sampleRate);
			expect(result.durationFrames).toBe(original.durationFrames);
			expect(result.channels).toBe(original.channels);

			// 32f should be lossless for Float32 data
			const origCh0 = original.samples[0]!;
			const resultCh0 = result.samples[0]!;
			const compareLength = Math.min(1000, original.durationFrames);

			for (let i = 0; i < compareLength; i++) {
				expect(resultCh0[i]).toBeCloseTo(origCh0[i]!, 5);
			}
		} finally {
			await unlink(tempOut).catch(() => undefined);
		}
	}, 240_000);
});
