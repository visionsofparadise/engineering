import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { expectedDuration, somethingChanged } from "../../utils/test-audio";
import { deBleed } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("DeBleed", () => {
	it("processes voice audio", async () => {
		const transform = deBleed(testVoice);
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
	}, 240_000);
});
