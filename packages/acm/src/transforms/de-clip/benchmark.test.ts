import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { deClip } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("deClip benchmark", () => {
	it("benchmarks deClip", async () => {
		const result = await runBenchmark("deClip", deClip(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
