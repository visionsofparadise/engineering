import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { audio, binaries } from "../../utils/test-binaries";
import { timeStretch } from ".";

const testVoice = audio.testVoice;

describe("time-stretch", () => {
	it("processes voice audio", async () => {
		const transform = timeStretch(binaries.ffmpeg, 1.5);
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
