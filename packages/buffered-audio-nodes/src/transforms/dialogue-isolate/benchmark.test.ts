import { describe, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { audio, binaries } from "../../utils/test-binaries";
import { dialogueIsolate } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = audio.testVoice;

describe("dialogue-isolate benchmark", () => {
	it("benchmarks dialogue-isolate", async () => {
		const result = await runBenchmark("dialogue-isolate", dialogueIsolate({ modelPath: binaries.kimVocal2, ffmpegPath: binaries.ffmpeg, onnxAddonPath: binaries.onnxAddon}), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
