import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { audio, binaries } from "../../utils/test-binaries";
import { musicRebalance } from ".";

const testVoice = audio.testVoice;

describe("music-rebalance", () => {
	it("processes voice audio", async () => {
		const transform = musicRebalance(binaries.htdemucs, { vocals: 1, drums: 0, bass: 0, other: 0 }, { onnxAddonPath: binaries.onnxAddon});
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);
});
