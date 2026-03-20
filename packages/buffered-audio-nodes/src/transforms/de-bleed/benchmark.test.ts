import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { deBleed } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("deBleed benchmark", () => {
	it("benchmarks deBleed", async () => {
		const result = await runBenchmark("deBleed", deBleed(testVoice), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
