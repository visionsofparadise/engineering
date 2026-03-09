import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { loudnessStats } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("loudnessStats benchmark", () => {
	it("benchmarks loudnessStats", async () => {
		const result = await runBenchmark("loudnessStats", loudnessStats(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
