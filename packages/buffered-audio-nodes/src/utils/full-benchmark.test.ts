import { describe, it } from "vitest";
import { runBenchmark, type BenchmarkResult } from "./test-benchmark";
import { audio, binaries } from "./test-binaries";
import { spectralRepair } from "../transforms/spectral-repair";
import { deReverb } from "../transforms/de-reverb";
import { voiceDenoise } from "../transforms/voice-denoise";
import { dialogueIsolate } from "../transforms/dialogue-isolate";
import { musicRebalance } from "../transforms/music-rebalance";
import { ExecutionProvider } from "@e9g/buffered-audio-nodes-core";

const testVoice = audio.testVoice;

// --- FFT backend configs ---
const fftConfigs: Array<{ label: string; providers: ReadonlyArray<ExecutionProvider> }> = [
	{ label: "js", providers: ["cpu"] },
	{ label: "fftw", providers: ["cpu-native", "cpu"] },
	{ label: "vkfft", providers: ["gpu", "cpu"] },
];

// --- ONNX configs ---
const onnxConfigs: Array<{ label: string; providers: ReadonlyArray<ExecutionProvider> }> = [
	{ label: "cpu", providers: ["cpu"] },
	{ label: "gpu+cpu", providers: ["gpu", "cpu-native", "cpu"] },
];

// --- Collect all results ---
const allResults: Array<{
	group: string;
	transform: string;
	backend: string;
	totalMs: number;
	rtx: number;
	samplesPerSec: number;
}> = [];

function record(group: string, transform: string, backend: string, r: BenchmarkResult) {
	allResults.push({
		group,
		transform,
		backend,
		totalMs: r.totalMs,
		rtx: r.realTimeMultiplier,
		samplesPerSec: r.samplesPerSecond,
	});
}

// ============================================================
// FFT-backend-aware transforms
// ============================================================
describe("FFT backends", () => {
	// spectral-repair
	for (const { label, providers } of fftConfigs) {
		it(`spectral-repair [${label}]`, async () => {
			const t = spectralRepair([{ startTime: 0.5, endTime: 0.6, startFreq: 1000, endFreq: 4000 }]);
			const r = await runBenchmark(`spectral-repair`, t, testVoice, { executionProviders: providers });
			record("fft", "spectral-repair", label, r);
		}, 240_000);
	}

	// de-reverb
	for (const { label, providers } of fftConfigs) {
		it(`de-reverb [${label}]`, async () => {
			const t = deReverb();
			const r = await runBenchmark(`de-reverb`, t, testVoice, { executionProviders: providers });
			record("fft", "de-reverb", label, r);
		}, 240_000);
	}

	// eq-match — needs a reference, skip if not easily constructable
	// voice-denoise (also ONNX — tests FFT portion)
	for (const { label, providers } of fftConfigs) {
		it(`voice-denoise [${label}]`, async () => {
			const t = voiceDenoise({ modelPath1: binaries.model1, modelPath2: binaries.model2, ffmpegPath: binaries.ffmpeg, onnxAddonPath: binaries.onnxAddon, vkfftAddonPath: binaries.vkfftAddon, fftwAddonPath: binaries.fftwAddon });
			const r = await runBenchmark(`voice-denoise`, t, testVoice, { executionProviders: providers });
			record("fft", "voice-denoise", label, r);
		}, 240_000);
	}
});

// ============================================================
// ONNX transforms
// ============================================================
describe("ONNX models", () => {
	for (const { label, providers } of onnxConfigs) {
		it(`voice-denoise [${label}]`, async () => {
			const t = voiceDenoise({ modelPath1: binaries.model1, modelPath2: binaries.model2, ffmpegPath: binaries.ffmpeg, onnxAddonPath: binaries.onnxAddon, vkfftAddonPath: binaries.vkfftAddon, fftwAddonPath: binaries.fftwAddon });
			const r = await runBenchmark(`voice-denoise`, t, testVoice, { executionProviders: providers });
			record("onnx", "voice-denoise", label, r);
		}, 240_000);
	}

	for (const { label, providers } of onnxConfigs) {
		it(`dialogue-isolate [${label}]`, async () => {
			const t = dialogueIsolate({ modelPath: binaries.kimVocal2, ffmpegPath: binaries.ffmpeg, onnxAddonPath: binaries.onnxAddon });
			const r = await runBenchmark(`dialogue-isolate`, t, testVoice, { executionProviders: providers });
			record("onnx", "dialogue-isolate", label, r);
		}, 240_000);
	}

	for (const { label, providers } of onnxConfigs) {
		it(`music-rebalance [${label}]`, async () => {
			const t = musicRebalance(binaries.htdemucs, { vocals: 1, drums: 0, bass: 0, other: 0 }, { onnxAddonPath: binaries.onnxAddon });
			const r = await runBenchmark(`music-rebalance`, t, testVoice, { executionProviders: providers });
			record("onnx", "music-rebalance", label, r);
		}, 240_000);
	}
});

// ============================================================
// Final summary
// ============================================================
describe("summary", () => {
	it("print results", () => {
		const pad = (s: string, n: number) => s.padStart(n);
		const rpad = (s: string, n: number) => s.padEnd(n);

		console.log("\n");
		console.log("=".repeat(90));
		console.log("  FULL BENCHMARK — test-voice.wav");
		console.log("=".repeat(90));

		// FFT section
		console.log("\n  FFT BACKENDS");
		console.log("  " + "-".repeat(86));
		console.log(
			"  " +
				rpad("Transform", 22) +
				pad("js", 12) +
				pad("fftw", 12) +
				pad("vkfft", 12) +
				pad("fftw/js", 10) +
				pad("vkfft/js", 10) +
				pad("best", 10),
		);
		console.log("  " + "-".repeat(86));

		const fftTransforms = [...new Set(allResults.filter((r) => r.group === "fft").map((r) => r.transform))];
		for (const transform of fftTransforms) {
			const js = allResults.find((r) => r.group === "fft" && r.transform === transform && r.backend === "js");
			const fftw = allResults.find((r) => r.group === "fft" && r.transform === transform && r.backend === "fftw");
			const vkfft = allResults.find((r) => r.group === "fft" && r.transform === transform && r.backend === "vkfft");

			const fmt = (r?: (typeof allResults)[0]) => (r ? `${r.totalMs.toFixed(0)}ms` : "—");
			const ratio = (a?: (typeof allResults)[0], b?: (typeof allResults)[0]) =>
				a && b ? `${(b.totalMs / a.totalMs).toFixed(2)}x` : "—";
			const best = [
				{ l: "js", ms: js?.totalMs ?? Infinity },
				{ l: "fftw", ms: fftw?.totalMs ?? Infinity },
				{ l: "vkfft", ms: vkfft?.totalMs ?? Infinity },
			].sort((a, b) => a.ms - b.ms)[0]!.l;

			console.log(
				"  " +
					rpad(transform, 22) +
					pad(fmt(js), 12) +
					pad(fmt(fftw), 12) +
					pad(fmt(vkfft), 12) +
					pad(ratio(fftw, js), 10) +
					pad(ratio(vkfft, js), 10) +
					pad(best, 10),
			);
		}

		// Real-time multipliers
		console.log("\n  " + rpad("(real-time)", 22));
		for (const transform of fftTransforms) {
			const js = allResults.find((r) => r.group === "fft" && r.transform === transform && r.backend === "js");
			const fftw = allResults.find((r) => r.group === "fft" && r.transform === transform && r.backend === "fftw");
			const vkfft = allResults.find((r) => r.group === "fft" && r.transform === transform && r.backend === "vkfft");

			const fmt = (r?: (typeof allResults)[0]) => (r ? `${r.rtx.toFixed(1)}x RT` : "—");
			console.log("  " + rpad(transform, 22) + pad(fmt(js), 12) + pad(fmt(fftw), 12) + pad(fmt(vkfft), 12));
		}

		// ONNX section
		console.log("\n  ONNX MODELS");
		console.log("  " + "-".repeat(60));
		console.log("  " + rpad("Transform", 22) + pad("cpu", 14) + pad("gpu+cpu", 14) + pad("speedup", 12));
		console.log("  " + "-".repeat(60));

		const onnxTransforms = [...new Set(allResults.filter((r) => r.group === "onnx").map((r) => r.transform))];
		for (const transform of onnxTransforms) {
			const cpu = allResults.find((r) => r.group === "onnx" && r.transform === transform && r.backend === "cpu");
			const gpu = allResults.find((r) => r.group === "onnx" && r.transform === transform && r.backend === "gpu+cpu");

			const fmt = (r?: (typeof allResults)[0]) => (r ? `${r.totalMs.toFixed(0)}ms` : "—");
			const ratio = cpu && gpu ? `${(cpu.totalMs / gpu.totalMs).toFixed(2)}x` : "—";
			console.log("  " + rpad(transform, 22) + pad(fmt(cpu), 14) + pad(fmt(gpu), 14) + pad(ratio, 12));
		}

		console.log("\n  " + rpad("(real-time)", 22));
		for (const transform of onnxTransforms) {
			const cpu = allResults.find((r) => r.group === "onnx" && r.transform === transform && r.backend === "cpu");
			const gpu = allResults.find((r) => r.group === "onnx" && r.transform === transform && r.backend === "gpu+cpu");

			const fmt = (r?: (typeof allResults)[0]) => (r ? `${r.rtx.toFixed(2)}x RT` : "—");
			console.log("  " + rpad(transform, 22) + pad(fmt(cpu), 14) + pad(fmt(gpu), 14));
		}

		console.log("\n" + "=".repeat(90));
		console.log(`  Node ${process.version} | ${process.platform}-${process.arch}`);
		console.log("=".repeat(90));
	});
});
