import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { expectedDuration, somethingChanged } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { deBleed } from ".";

const testVoice = audio.testVoice;

describe("DeBleed", () => {
	it("processes voice audio", async () => {
		const transform = deBleed(testVoice);
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
	}, 240_000);
});
