import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { binaries } from "../../utils/test-binaries";
import { timeStretch } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("time-stretch benchmark", () => {
	it("benchmarks time-stretch", async () => {
		const result = await runBenchmark("time-stretch", timeStretch(binaries.ffmpeg, 1.5), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
