import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { pitchShift } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("pitch-shift benchmark", () => {
	it("benchmarks pitch-shift", async () => {
		const result = await runBenchmark("pitch-shift", pitchShift(2), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
