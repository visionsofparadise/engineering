import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { loudness } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("loudness benchmark", () => {
	it("benchmarks loudness", async () => {
		const result = await runBenchmark("loudness", loudness({ target: -16, truePeak: -1 }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
