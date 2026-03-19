import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { binaries } from "../../utils/test-binaries";
import { timeStretch } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("time-stretch", () => {
	it("processes voice audio", async () => {
		const transform = timeStretch(binaries.ffmpeg, 1.5);
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
