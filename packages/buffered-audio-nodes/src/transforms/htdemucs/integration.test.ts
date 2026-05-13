import { describe, it, expect } from "vitest";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { audio, binaries, hasAudioFixtures, hasBinaryFixtures } from "../../utils/test-binaries";
import { htdemucs } from ".";

const testVoice = audio.testVoice;
const testVoice48k = audio.testVoice48k;
const describeIfFixtureSet = hasBinaryFixtures("htdemucs", "htdemucsData", "onnxAddon") ? describe : describe.skip;

describeIfFixtureSet("htdemucs", () => {
	it("processes voice audio", async () => {
		const transform = htdemucs(binaries.htdemucs, { vocals: 1, drums: 0, bass: 0, other: 0 }, { onnxAddonPath: binaries.onnxAddon});
		const { input, output, context } = await runTransform(testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);

	// Exercises the resample path inside `_process` (`needsResample === true`
	// because the input sample rate differs from htdemucs's 44.1 kHz native).
	// The transform spawns `ResampleStream` for input + output resampling via
	// ffmpeg subprocesses with the Phase 9.3 background pump/drainer pattern.
	// The test only passes if the pump/drainer pattern is correct — otherwise
	// ffmpeg's ~225 K stdin buffer causes the segment loop to deadlock waiting
	// for resampler stdout that never arrives.
	(hasBinaryFixtures("ffmpeg") && hasAudioFixtures("testVoice48k") ? it : it.skip)("processes voice audio at 48 kHz (resample path)", async () => {
		const transform = htdemucs(binaries.htdemucs, { vocals: 1, drums: 0, bass: 0, other: 0 }, { onnxAddonPath: binaries.onnxAddon, ffmpegPath: binaries.ffmpeg });
		const { input, output, context } = await runTransform(testVoice48k, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);
});
