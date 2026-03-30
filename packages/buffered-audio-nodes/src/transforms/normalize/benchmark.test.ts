import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { normalize } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("normalize benchmark", () => {
	it("benchmarks normalize", async () => {
		const result = await runBenchmark("normalize", normalize({ ceiling: 0.9 }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
