import { describe, it } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { ffmpeg } from ".";
import { binaries } from "../../utils/test-binaries";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("ffmpeg benchmark", () => {
	it("benchmarks ffmpeg", async () => {
		const result = await runBenchmark("ffmpeg", ffmpeg({ ffmpegPath: binaries.ffmpeg, args: ["-af", "volume=1.0"] }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
