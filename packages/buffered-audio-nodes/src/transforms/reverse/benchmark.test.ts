import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { reverse } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("reverse benchmark", () => {
	it("benchmarks reverse", async () => {
		const result = await runBenchmark("reverse", reverse(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
