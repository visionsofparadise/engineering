import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { spectralRepair } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("SpectralRepair", () => {
  it("processes voice audio", async () => {
    const transform = spectralRepair([{ startTime: 0.5, endTime: 0.6, startFreq: 1000, endFreq: 4000 }]);
    const { input, output, context } = await runTransform(testVoice, transform);

    expect(notSilent(output).pass).toBe(true);
    expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
    expect(somethingChanged(input, output).pass).toBe(true);
    expect(notAnomalous(output).pass).toBe(true);
  }, 120_000);
});
