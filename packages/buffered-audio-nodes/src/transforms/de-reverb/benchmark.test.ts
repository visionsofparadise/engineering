import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deReverb } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deReverb benchmark", () => {
	it("benchmarks deReverb", async () => {
		const result = await runBenchmark("deReverb", deReverb(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
