import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { leveler } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("leveler benchmark", () => {
	it("benchmarks leveler", async () => {
		const result = await runBenchmark("leveler", leveler(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
