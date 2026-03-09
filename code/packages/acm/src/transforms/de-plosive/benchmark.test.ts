import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { dePlosive } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("dePlosive benchmark", () => {
	it("benchmarks dePlosive", async () => {
		const result = await runBenchmark("dePlosive", dePlosive(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
