import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { leveler } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("leveler benchmark", () => {
	it("benchmarks leveler", async () => {
		const result = await runBenchmark("leveler", leveler(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
