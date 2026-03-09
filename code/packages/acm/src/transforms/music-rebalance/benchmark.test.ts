import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { musicRebalance } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("music-rebalance benchmark", () => {
	it("benchmarks music-rebalance", async () => {
		const result = await runBenchmark("music-rebalance", musicRebalance("D:/Code/demucs.onnx/htdemucs.onnx", { vocals: 1, drums: 0, bass: 0, other: 0 }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
