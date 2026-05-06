import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, notAnomalous } from "../../utils/test-audio";
import { audio, binaries, hasBinaryFixtures } from "../../utils/test-binaries";
import { readToBuffer } from "../../utils/read-to-buffer";
import { read } from "../../sources/read";
import { write } from "../../targets/write";
import { chain } from "../../composites/chain";
import { ffmpeg } from ".";

const testVoice = audio.testVoice;
const describeIfFfmpegFixture = hasBinaryFixtures("ffmpeg") ? describe : describe.skip;

describeIfFfmpegFixture("FFmpeg", () => {
	it("processes voice audio", async () => {
		const transform = ffmpeg({ ffmpegPath: binaries.ffmpeg, args: ["-af", "anull"] });
		const { output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);

	it("passes audio through unchanged with anull", async () => {
		const transform = ffmpeg({ ffmpegPath: binaries.ffmpeg, args: ["-af", "anull"] });
		const { input, output } = await runTransform(testVoice, transform);

		expect(output.length).toBe(input.length);

		for (let ch = 0; ch < input.length; ch++) {
			const inputChannel = input[ch];
			const outputChannel = output[ch];

			if (!inputChannel || !outputChannel) throw new Error(`Channel ${ch} missing`);

			expect(outputChannel.length).toBe(inputChannel.length);

			let maxAbsDiff = 0;

			for (let i = 0; i < inputChannel.length; i++) {
				const diff = Math.abs((outputChannel[i] ?? 0) - (inputChannel[i] ?? 0));

				if (diff > maxAbsDiff) maxAbsDiff = diff;
			}

			// `anull` is a documented no-op filter on f32le passthrough; samples must
			// be exact (or below 1e-7 to allow for any internal float promotion).
			expect(maxAbsDiff).toBeLessThanOrEqual(1e-7);
		}
	}, 240_000);

	it("resample roundtrip preserves length within ±2 frames", async () => {
		const { context: inputContext } = await readToBuffer(testVoice);
		const origRate = inputContext.sampleRate;
		const inputFrames = inputContext.durationFrames ?? 0;
		const tempPath = join(tmpdir(), `ban-test-${randomBytes(8).toString("hex")}.wav`);

		try {
			const pipeline = chain(
				read(testVoice),
				ffmpeg({ ffmpegPath: binaries.ffmpeg, args: ["-af", "aresample=24000"], outputSampleRate: 24000 }),
				ffmpeg({ ffmpegPath: binaries.ffmpeg, args: ["-af", `aresample=${origRate}`], outputSampleRate: origRate }),
				write(tempPath, { bitDepth: "32f" }),
			);

			await pipeline.render();

			const { context: outputContext } = await readToBuffer(tempPath);
			const outputFrames = outputContext.durationFrames ?? 0;

			// Resampling rounds at each stage; allow ±2 frames slack.
			expect(Math.abs(outputFrames - inputFrames)).toBeLessThanOrEqual(2);
		} finally {
			try {
				await unlink(tempPath);
			} catch {
				// Temp file may not exist if pipeline failed before write.
			}
		}
	}, 240_000);
});
