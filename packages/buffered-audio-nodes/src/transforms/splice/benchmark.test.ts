import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { splice } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("splice benchmark", () => {
	it("benchmarks splice", async () => {
		const result = await runBenchmark("splice", splice(testVoice, 0), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
