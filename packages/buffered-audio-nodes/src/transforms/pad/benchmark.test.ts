import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { pad } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("pad benchmark", () => {
	it("benchmarks pad", async () => {
		const result = await runBenchmark("pad", pad({ after: 1.0 }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
