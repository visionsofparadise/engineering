import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { binaries } from "../../utils/test-binaries";
import { voiceDenoise } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("voice-denoise benchmark", () => {
	it("benchmarks voice-denoise", async () => {
		const result = await runBenchmark("voice-denoise", voiceDenoise({ modelPath1: binaries.model1, modelPath2: binaries.model2, ffmpegPath: binaries.ffmpeg, onnxAddonPath: binaries.onnxAddon, vkfftAddonPath: binaries.vkfftAddon, fftwAddonPath: binaries.fftwAddon }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
