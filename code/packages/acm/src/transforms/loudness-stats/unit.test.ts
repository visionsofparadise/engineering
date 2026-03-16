import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, notAnomalous } from "../../utils/test-audio";
import { loudnessStats } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("loudness-stats", () => {
	it("processes voice audio and produces stats", async () => {
		const transform = loudnessStats();
		const { output } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);

		expect(transform.stats).toBeDefined();
		expect(transform.stats!.integrated).toBeGreaterThan(-70);
		expect(transform.stats!.integrated).toBeLessThan(0);
	}, 240_000);
});
