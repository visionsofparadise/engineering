import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ffmpeg } from ".";
import { notAnomalous, notSilent, somethingChanged } from "../../utils/test-audio";
import { runTransform } from "../../utils/test-pipeline";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("ffmpeg-command", () => {
	it("processes voice audio", async () => {
		const transform = ffmpeg({ args: ["-af", "aecho=0.8:0.88:60:0.4"] });
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
