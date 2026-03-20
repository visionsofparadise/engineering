import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { loudness } from ".";
import { binaries } from "../../utils/test-binaries";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("loudness benchmark", () => {
	it("benchmarks loudness", async () => {
		const result = await runBenchmark("loudness", loudness(binaries.ffmpeg), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
