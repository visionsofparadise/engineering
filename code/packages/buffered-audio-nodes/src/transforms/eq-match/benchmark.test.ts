import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { eqMatch } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("eqMatch benchmark", () => {
	it("benchmarks eqMatch", async () => {
		const result = await runBenchmark("eqMatch", eqMatch(testVoice), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
