/* eslint-disable no-console */
import {
  BlitRenderer,
  computeIntegratedLufs,
  computeMomentaryLufs,
  computeRunningIntegratedLufs,
  createScanContext,
  finalizeScan,
  getDevice,
  meanSquareToLufs,
  resolveConfig,
  scanSamples,
  SpectralEngine,
} from "spectral-display";
import { loadAudio } from "./audio-loader";

const WAVEFORM_POINTS_PER_SECOND = 500;
const DEFAULT_CHUNK_SIZE = 131072;

const WIDTH = 800;
const HEIGHT = 200;

interface BenchResult {
	timestamp: string;
	test: string;
	durationMs: number;
}

const log: Array<BenchResult> = [];

const container = document.getElementById("root")!;

function appendLog(entry: BenchResult) {
	log.push(entry);
	console.log(`[${entry.timestamp}] ${entry.test}: ${entry.durationMs.toFixed(1)}ms`);
}

function renderLog() {
	const header = "timestamp | test | ms\n" + "--- | --- | ---\n";
	const rows = log.map((entry) => `${entry.timestamp} | ${entry.test} | ${entry.durationMs.toFixed(1)}`);

	container.innerHTML = `<pre style="font-family:monospace;padding:24px">${header}${rows.join("\n")}</pre>`;
}

async function benchPipeline(
	device: GPUDevice,
	engine: SpectralEngine,
	blit: { resize: (w: number, h: number) => void; render: (t: GPUTexture) => void },
	readSamples: (channel: number, offset: number, count: number) => Promise<Float32Array>,
	sampleRate: number,
	channels: number,
	totalSamples: number,
) {
	const sampleCount = totalSamples;
	const samplesPerPoint = Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND);
	const pointCount = Math.ceil(sampleCount / samplesPerPoint);
	const signal = new AbortController().signal;
	const options = resolveConfig({ device, signal });

	const scanContext = createScanContext({ sampleRate, sampleCount: totalSamples, channelCount: channels }, pointCount, samplesPerPoint, DEFAULT_CHUNK_SIZE);

	const spectralCtx = await engine.prepare(sampleCount, sampleRate, options);

	let readTime = 0;
	let gpuSubmitTime = 0;
	const scanTiming = { channelPass: 0, reduction: 0 };
	let offset = 0;

	while (offset < sampleCount) {
		const chunkFrames = Math.min(DEFAULT_CHUNK_SIZE, sampleCount - offset);
		const channelBuffers: Array<Float32Array> = [];

		let t0 = performance.now();

		for (let ch = 0; ch < channels; ch++) {
			channelBuffers.push(await readSamples(ch, offset, chunkFrames));
		}

		readTime += performance.now() - t0;

		scanSamples(channelBuffers, chunkFrames, scanContext, scanTiming);

		t0 = performance.now();
		engine.submitChunk(scanContext.monoBuffer, chunkFrames, spectralCtx);
		gpuSubmitTime += performance.now() - t0;

		offset += chunkFrames;
	}

	finalizeScan(scanContext);

	// Wait for all FFT dispatches to actually complete on GPU
	const gpuFftWaitStart = performance.now();

	await device.queue.onSubmittedWorkDone();
	const gpuFftTime = performance.now() - gpuFftWaitStart;

	const lufsStart = performance.now();

	const momentaryWindowPoints = Math.round(0.4 * WAVEFORM_POINTS_PER_SECOND);
	const shortTermWindowPoints = Math.round(3 * WAVEFORM_POINTS_PER_SECOND);

	computeMomentaryLufs(scanContext.kWeightedMeanSquare, momentaryWindowPoints);
	computeMomentaryLufs(scanContext.kWeightedMeanSquare, shortTermWindowPoints);

	const blockPoints = Math.round(0.4 * WAVEFORM_POINTS_PER_SECOND);
	const stepPoints = Math.round(0.1 * WAVEFORM_POINTS_PER_SECOND);
	const blockLoudnessValues: Array<number> = [];

	for (let start = 0; start + blockPoints <= scanContext.state.pointIndex; start += stepPoints) {
		let sum = 0;

		for (let pt = start; pt < start + blockPoints; pt++) {
			sum += scanContext.kWeightedMeanSquare[pt]!;
		}

		blockLoudnessValues.push(meanSquareToLufs(sum / blockPoints));
	}

	const blockLoudness = new Float32Array(blockLoudnessValues);

	computeIntegratedLufs(blockLoudness);
	computeRunningIntegratedLufs(blockLoudness);

	const lufsTime = performance.now() - lufsStart;

	const vizStart = performance.now();
	const result = engine.finalize({ width: WIDTH, height: HEIGHT }, spectralCtx, options);

	blit.resize(WIDTH, HEIGHT);
	blit.render(result.spectrogramTexture);
	await device.queue.onSubmittedWorkDone();
	const gpuVizTime = performance.now() - vizStart;

	result.spectrogramTexture.destroy();

	return { readTime, scanTiming, gpuSubmitTime, gpuFftTime, lufsTime, gpuVizTime };
}

interface Breakdown {
	readTime: number;
	scanTiming: { channelPass: number; reduction: number };
	gpuSubmitTime: number;
	gpuFftTime: number;
	lufsTime: number;
	gpuVizTime: number;
}

async function main() {
	container.innerHTML = "<pre style='font-family:monospace;padding:24px'>Loading audio...</pre>";

	const audio = await loadAudio("/test-music.wav");
	const { sampleRate, channels, totalSamples, readSamples } = audio;
	const durationSec = totalSamples / sampleRate;

	console.log(`Audio: ${durationSec.toFixed(1)}s, ${sampleRate}Hz, ${channels}ch, ${totalSamples} samples`);
	container.innerHTML = "<pre style='font-family:monospace;padding:24px'>Initializing GPU...</pre>";

	const device = await getDevice();
	const engine = new SpectralEngine(device);

	const canvas = document.createElement("canvas");

	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	container.appendChild(canvas);

	const blit = new BlitRenderer(device, canvas);

	container.innerHTML = "<pre style='font-family:monospace;padding:24px'>Running benchmarks...</pre>";
	container.appendChild(canvas);

	const run = () => benchPipeline(device, engine, blit, readSamples, sampleRate, channels, totalSamples);

	// Warmup
	await run();

	const runs = 3;
	const results: Array<{ total: number; breakdown: Breakdown }> = [];

	for (let ri = 0; ri < runs; ri++) {
		const start = performance.now();
		const breakdown = await run();
		const total = performance.now() - start;

		results.push({ total, breakdown });
	}

	results.sort((left, right) => left.total - right.total);
	const median = results[Math.floor(runs / 2)]!;

	const ts = new Date().toISOString();
	const bd = median.breakdown;

	appendLog({ timestamp: ts, test: "total", durationMs: median.total });
	appendLog({ timestamp: ts, test: "  read", durationMs: bd.readTime });
	appendLog({ timestamp: ts, test: "  scan: earlier channels", durationMs: bd.scanTiming.channelPass });
	appendLog({ timestamp: ts, test: "  scan: last channel + reduce", durationMs: bd.scanTiming.reduction });
	appendLog({ timestamp: ts, test: "  gpu submit (js)", durationMs: bd.gpuSubmitTime });
	appendLog({ timestamp: ts, test: "  gpu fft (actual)", durationMs: bd.gpuFftTime });
	appendLog({ timestamp: ts, test: "  lufs post", durationMs: bd.lufsTime });
	appendLog({ timestamp: ts, test: "  gpu viz (actual)", durationMs: bd.gpuVizTime });
	renderLog();

	engine.destroy();
	console.log("Benchmark complete. Full log:", log);
}

void main();
