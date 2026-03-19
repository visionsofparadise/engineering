import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { normalize } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("normalize benchmark", () => {
	it("benchmarks normalize", async () => {
		const result = await runBenchmark("normalize", normalize({ ceiling: 0.9 }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
