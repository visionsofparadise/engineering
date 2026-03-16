import { describe, it } from "vitest";
import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmark, appendBenchmarkLog } from "../../utils/test-benchmark";
import { binaries } from "../../utils/test-binaries";
import { spectrogram } from ".";

const here = dirname(fileURLToPath(import.meta.url));
const testVoice = resolve(here, "../../utils/test-voice.wav");

const configs = [
	{ name: "spectrogram [js]", fftwAddonPath: "" },
	{ name: "spectrogram [fftw]", fftwAddonPath: binaries.fftwAddon },
];

describe("spectrogram benchmark", () => {
	for (const config of configs) {
		it(`benchmarks ${config.name}`, async () => {
			const tempSpec = resolve(tmpdir(), `acm-spec-bench-${randomBytes(8).toString("hex")}.bin`);

			try {
				const result = await runBenchmark(config.name, spectrogram(tempSpec, { fftSize: 4096, hopSize: 4096, fftwAddonPath: config.fftwAddonPath }), testVoice);
				await appendBenchmarkLog(here, result);
			} finally {
				await unlink(tempSpec).catch(() => undefined);
			}
		}, 240_000);
	}
});
