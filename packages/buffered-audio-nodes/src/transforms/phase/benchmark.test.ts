import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { phase } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("phase benchmark", () => {
	it("benchmarks phase", async () => {
		const result = await runBenchmark("phase", phase({ invert: true }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
