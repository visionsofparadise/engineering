import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deBleed } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deBleed benchmark", () => {
	it("benchmarks deBleed", async () => {
		const result = await runBenchmark("deBleed", deBleed(testVoice), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
