import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { dialogueIsolate } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("dialogue-isolate benchmark", () => {
	it("benchmarks dialogue-isolate", async () => {
		const result = await runBenchmark("dialogue-isolate", dialogueIsolate(), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
