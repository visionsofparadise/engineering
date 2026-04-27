import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { deClick } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("deClick benchmark", () => {
	it("benchmarks deClick", async () => {
		const node = deClick({
			sensitivity: 0.5,
			frequencySkew: 0.2,
			clickWidening: 0.25,
			maxClickDuration: 200,
		});
		const result = await runBenchmark("deClick", node, testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
