import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deReverbWpe } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deReverbWpe benchmark", () => {
	it("benchmarks deReverbWpe", async () => {
		const result = await runBenchmark("deReverbWpe", deReverbWpe(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
