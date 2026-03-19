import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { dither } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("dither benchmark", () => {
	it("benchmarks dither", async () => {
		const result = await runBenchmark("dither", dither(16), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
