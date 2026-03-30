import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deClick } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deClick benchmark", () => {
	it("benchmarks deClick", async () => {
		const result = await runBenchmark("deClick", deClick(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
