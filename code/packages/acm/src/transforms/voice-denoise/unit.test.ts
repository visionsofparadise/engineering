import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { voiceDenoise } from ".";

const testVoice = resolve(dirname(fileURLToPath(import.meta.url)), "../../utils/test-voice.wav");

describe("voice-denoise", () => {
	it("processes voice audio", async () => {
		const transform = voiceDenoise("D:/Code/dtln.onnx");
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.duration ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);
});
