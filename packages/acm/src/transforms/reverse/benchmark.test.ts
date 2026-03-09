import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { reverse } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("reverse benchmark", () => {
	it("benchmarks reverse", async () => {
		const result = await runBenchmark("reverse", reverse(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
