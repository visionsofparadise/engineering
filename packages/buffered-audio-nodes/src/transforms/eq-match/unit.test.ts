import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, notAnomalous } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { eqMatch } from ".";

const testVoice = audio.testVoice;

describe("EqMatch", () => {
	it("processes voice audio", async () => {
		const transform = eqMatch(testVoice);
		const { output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);
});
