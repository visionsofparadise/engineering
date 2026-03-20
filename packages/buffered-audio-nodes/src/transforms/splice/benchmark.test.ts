import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { splice } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("splice benchmark", () => {
	it("benchmarks splice", async () => {
		const result = await runBenchmark("splice", splice(testVoice, 0), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
