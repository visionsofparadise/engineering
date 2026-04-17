import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { audio, binaries, hasBinaryFixtures } from "../../utils/test-binaries";
import { resample } from ".";

const testVoice = audio.testVoice;
const describeIfFfmpegFixture = hasBinaryFixtures("ffmpeg") ? describe : describe.skip;

describeIfFfmpegFixture("resample", () => {
	it("processes voice audio", async () => {
		const transform = resample(binaries.ffmpeg, 16000);
		const { input, output } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
