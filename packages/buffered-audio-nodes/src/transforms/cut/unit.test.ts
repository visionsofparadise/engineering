import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, notAnomalous } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { cut } from ".";

const testVoice = audio.testVoice;

describe("cut", () => {
	it("removes a region from voice audio", async () => {
		const transform = cut([{ start: 1, end: 3 }]);
		const { input, output } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(output[0]!.length).toBeLessThan(input[0]!.length);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
