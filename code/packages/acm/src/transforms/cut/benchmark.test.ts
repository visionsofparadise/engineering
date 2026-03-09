import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { cut } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("cut benchmark", () => {
	it("benchmarks cut", async () => {
		const result = await runBenchmark("cut", cut([{ start: 1, end: 3 }]), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
