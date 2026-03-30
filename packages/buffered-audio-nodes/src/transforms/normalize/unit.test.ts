import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { audio } from "../../utils/test-binaries";
import { normalize } from ".";

const testVoice = audio.testVoice;

describe("Normalize", () => {
  it("processes voice audio", async () => {
    const transform = normalize({ ceiling: 0.9 });
    const { input, output, context } = await runTransform(testVoice, transform);

    expect(notSilent(output).pass).toBe(true);
    expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
    expect(somethingChanged(input, output).pass).toBe(true);
    expect(notAnomalous(output).pass).toBe(true);
  }, 120_000);
});
