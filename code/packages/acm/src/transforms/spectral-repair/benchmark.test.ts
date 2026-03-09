import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { spectralRepair } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("spectralRepair benchmark", () => {
	it("benchmarks spectralRepair", async () => {
		const result = await runBenchmark("spectralRepair", spectralRepair([{ startTime: 0.5, endTime: 0.6, startFreq: 1000, endFreq: 4000 }]), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
