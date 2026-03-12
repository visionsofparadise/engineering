import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { breathControl } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("breathControl benchmark", () => {
	it("benchmarks breathControl", async () => {
		const result = await runBenchmark("breathControl", breathControl(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
