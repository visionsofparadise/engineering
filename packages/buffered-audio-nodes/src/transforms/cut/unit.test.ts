import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, notAnomalous } from "../../utils/test-audio";
import { cut } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("cut", () => {
	it("removes a region from voice audio", async () => {
		const transform = cut([{ start: 1, end: 3 }]);
		const { input, output } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(output[0]!.length).toBeLessThan(input[0]!.length);
		expect(notAnomalous(output).pass).toBe(true);
	}, 120_000);
});
