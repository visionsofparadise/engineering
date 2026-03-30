import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, notAnomalous } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { trim } from ".";

const testVoice = audio.testVoice;

describe("trim", () => {
	it("trims silence from voice audio", async () => {
		const transform = trim();
		const { input, output } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(output[0]!.length).toBeLessThanOrEqual(input[0]!.length);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
