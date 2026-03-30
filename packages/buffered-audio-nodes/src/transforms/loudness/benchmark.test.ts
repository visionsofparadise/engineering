import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { loudness } from ".";
import { audio, binaries } from "../../utils/test-binaries";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("loudness benchmark", () => {
	it("benchmarks loudness", async () => {
		const result = await runBenchmark("loudness", loudness(binaries.ffmpeg), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
