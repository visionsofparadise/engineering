import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio } from "../../utils/test-binaries";
import { eqMatch } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("eqMatch benchmark", () => {
	it("benchmarks eqMatch", async () => {
		const result = await runBenchmark("eqMatch", eqMatch(testVoice), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
