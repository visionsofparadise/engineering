import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { voiceDenoise } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("voice-denoise benchmark", () => {
	it("benchmarks voice-denoise", async () => {
		const result = await runBenchmark("voice-denoise", voiceDenoise("D:/Code/dtln.onnx"), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
