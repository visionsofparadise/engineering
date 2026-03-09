import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { resample } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("resample benchmark", () => {
	it("benchmarks resample", async () => {
		const result = await runBenchmark("resample", resample(22050), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
