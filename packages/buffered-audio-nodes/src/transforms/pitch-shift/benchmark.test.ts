import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio, binaries } from "../../utils/test-binaries";
import { pitchShift } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("pitch-shift benchmark", () => {
	it("benchmarks pitch-shift", async () => {
		const result = await runBenchmark("pitch-shift", pitchShift(binaries.ffmpeg, 2), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
