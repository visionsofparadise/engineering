import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { binaries } from "../../utils/test-binaries";
import { ffmpeg } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("FFmpeg", () => {
	it("processes voice audio", async () => {
		const transform = ffmpeg({ ffmpegPath: binaries.ffmpeg, args: ["-af", "anull"] });
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);
});
