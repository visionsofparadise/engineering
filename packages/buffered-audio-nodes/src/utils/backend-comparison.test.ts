import { describe, it } from "vitest";
import { runBenchmark } from "./test-benchmark";
import { audio } from "./test-binaries";
import { spectralRepair } from "../transforms/spectral-repair";
import { deReverbWpe } from "../transforms/de-reverb-wpe";
import { ExecutionProvider } from "@e9g/buffered-audio-nodes-core";

const testVoice = audio.testVoice;

const configs: Array<{ label: string; providers: ReadonlyArray<ExecutionProvider> }> = [
	{ label: "js", providers: ["cpu"] },
	{ label: "fftw", providers: ["cpu-native", "cpu"] },
	{ label: "vkfft", providers: ["gpu", "cpu"] },
];

describe("backend comparison", () => {
	describe("spectral-repair", () => {
		const results: Array<{ label: string; totalMs: number; rtx: number }> = [];

		for (const { label, providers } of configs) {
			it(`spectral-repair [${label}]`, async () => {
				const transform = spectralRepair([{ startTime: 0.5, endTime: 0.6, startFreq: 1000, endFreq: 4000 }]);
				const result = await runBenchmark(`spectral-repair-${label}`, transform, testVoice, { executionProviders: providers });
				results.push({ label, totalMs: result.totalMs, rtx: result.realTimeMultiplier });
				console.log(`  ${label}: ${result.totalMs.toFixed(1)}ms | ${result.realTimeMultiplier.toFixed(2)}x RT | ${Math.round(result.samplesPerSecond)} samples/sec`);
			}, 240_000);
		}

		it("summary", () => {
			if (results.length < 2) return;
			console.log("\n  === spectral-repair summary ===");
			const jsResult = results.find(r => r.label === "js");
			for (const r of results) {
				const speedup = jsResult ? (jsResult.totalMs / r.totalMs).toFixed(2) + "x vs js" : "";
				console.log(`  ${r.label.padEnd(6)} ${r.totalMs.toFixed(1).padStart(10)}ms  ${r.rtx.toFixed(2).padStart(8)}x RT  ${speedup}`);
			}
		});
	});

	describe("de-reverb-wpe", () => {
		const results: Array<{ label: string; totalMs: number; rtx: number }> = [];

		for (const { label, providers } of configs) {
			it(`de-reverb-wpe [${label}]`, async () => {
				const transform = deReverbWpe();
				const result = await runBenchmark(`de-reverb-wpe-${label}`, transform, testVoice, { executionProviders: providers });
				results.push({ label, totalMs: result.totalMs, rtx: result.realTimeMultiplier });
				console.log(`  ${label}: ${result.totalMs.toFixed(1)}ms | ${result.realTimeMultiplier.toFixed(2)}x RT | ${Math.round(result.samplesPerSecond)} samples/sec`);
			}, 240_000);
		}

		it("summary", () => {
			if (results.length < 2) return;
			console.log("\n  === de-reverb-wpe summary ===");
			const jsResult = results.find(r => r.label === "js");
			for (const r of results) {
				const speedup = jsResult ? (jsResult.totalMs / r.totalMs).toFixed(2) + "x vs js" : "";
				console.log(`  ${r.label.padEnd(6)} ${r.totalMs.toFixed(1).padStart(10)}ms  ${r.rtx.toFixed(2).padStart(8)}x RT  ${speedup}`);
			}
		});
	});
});
