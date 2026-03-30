import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, notAnomalous } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { pad } from ".";

const testVoice = audio.testVoice;

describe("pad", () => {
	it("processes voice audio", async () => {
		const transform = pad({ after: 1.0 });
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(output[0]!.length).toBeGreaterThan(input[0]!.length);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
