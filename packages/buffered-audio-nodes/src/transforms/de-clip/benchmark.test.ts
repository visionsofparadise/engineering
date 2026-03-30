import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deClip } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deClip benchmark", () => {
	it("benchmarks deClip", async () => {
		const result = await runBenchmark("deClip", deClip(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
