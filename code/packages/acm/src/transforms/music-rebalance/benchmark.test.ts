import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { binaries } from "../../utils/test-binaries";
import { musicRebalance } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("music-rebalance benchmark", () => {
	it("benchmarks music-rebalance", async () => {
		const result = await runBenchmark("music-rebalance", musicRebalance(binaries.htdemucs, { vocals: 1, drums: 0, bass: 0, other: 0 }, { onnxAddonPath: binaries.onnxAddon}), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
