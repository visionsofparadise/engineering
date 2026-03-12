import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { deReverb } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("deReverb benchmark", () => {
	it("benchmarks deReverb", async () => {
		const result = await runBenchmark("deReverb", deReverb(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
