import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { ffmpeg } from ".";
import { appendBenchmarkLog, runBenchmark } from "../../utils/test-benchmark";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

describe("ffmpeg-command benchmark", () => {
	it("benchmarks ffmpeg-command", async () => {
		const result = await runBenchmark("ffmpeg-command", ffmpeg({ args: ["-af", "aecho=0.8:0.88:60:0.4"] }), testVoice);
		await appendBenchmarkLog(here, result);
	}, 240_000);
});
