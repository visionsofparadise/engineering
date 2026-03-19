import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { trim } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("trim benchmark", () => {
	it("benchmarks trim", async () => {
		const result = await runBenchmark("trim", trim(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
