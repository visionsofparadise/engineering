import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { trim } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("trim benchmark", () => {
	it("benchmarks trim", async () => {
		const result = await runBenchmark("trim", trim(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
