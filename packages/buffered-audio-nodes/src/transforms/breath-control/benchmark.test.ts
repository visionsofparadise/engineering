import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { breathControl } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("breathControl benchmark", () => {
	it("benchmarks breathControl", async () => {
		const result = await runBenchmark("breathControl", breathControl(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
