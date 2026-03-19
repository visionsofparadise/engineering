import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { phase } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("phase benchmark", () => {
	it("benchmarks phase", async () => {
		const result = await runBenchmark("phase", phase({ invert: true }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
