import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deBleedAdaptive } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deBleedAdaptive benchmark", () => {
	it("benchmarks deBleedAdaptive", async () => {
		const result = await runBenchmark("deBleedAdaptive", deBleedAdaptive(testVoice), testVoice);
		await appendBenchmarkLog(here, result);
	}, 900_000);
});
