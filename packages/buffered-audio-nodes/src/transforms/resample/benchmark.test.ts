import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { resample } from ".";
import { audio, binaries } from "../../utils/test-binaries";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("resample benchmark", () => {
	it("benchmarks resample", async () => {
		const result = await runBenchmark("resample", resample(binaries.ffmpeg, 48000), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
