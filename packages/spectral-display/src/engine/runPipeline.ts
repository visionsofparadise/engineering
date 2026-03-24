import type { RequiredProperties } from "../utils/RequiredProperties";
import { resolveConfig, type Dimensions, type SpectralConfig, type SpectralEngine } from "./SpectralEngine";
import type { LoudnessData } from "./loudness";
import { computeLoudnessData, WAVEFORM_POINTS_PER_SECOND } from "./loudness";
import { createScanContext, finalizeScan, scanSamples } from "./sample-scan";

export interface SpectralMetadata {
	sampleRate: number;
	sampleCount: number;
	channelCount: number;
	channelWeights?: ReadonlyArray<number>;
}

export interface SampleQuery extends Dimensions {
	startSample: number;
	endSample: number;
}

export interface PipelineOptions {
	metadata: SpectralMetadata;
	sampleQuery: SampleQuery;
	readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
	config: RequiredProperties<SpectralConfig, "device" | "signal">;
}

export interface ResolvedPipelineOptions extends PipelineOptions {
	config: SpectralConfig;
}

export interface PipelineResult {
	waveformBuffer: Float32Array;
	waveformPointCount: number;
	loudnessData: LoudnessData | null;
	spectrogramTexture: GPUTexture | null;
	options: ResolvedPipelineOptions;
}

const DEFAULT_CHUNK_SIZE = 131072;

declare const scheduler: { yield(): Promise<void> } | undefined;

function yieldControl(): Promise<void> {
	if (typeof scheduler !== "undefined" && typeof scheduler.yield === "function") {
		return scheduler.yield();
	}

	return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function runPipeline(options: PipelineOptions, engine: SpectralEngine): Promise<PipelineResult> {
	const { metadata, sampleQuery, readSamples, config } = options;
	const { sampleRate, channelCount } = metadata;
	const { startSample, endSample } = sampleQuery;
	const { signal } = config;

	const sampleCount = endSample - startSample;
	const samplesPerPoint = Math.round(sampleRate / WAVEFORM_POINTS_PER_SECOND);
	const pointCount = Math.ceil(sampleCount / samplesPerPoint);

	const resolvedConfig = resolveConfig(config);
	const { spectrogram, loudness, truePeak: computeTruePeak } = resolvedConfig;

	const scanContext = createScanContext(metadata, pointCount, samplesPerPoint, DEFAULT_CHUNK_SIZE, loudness, computeTruePeak);

	const spectralContext = spectrogram ? await engine.prepare(sampleCount, sampleRate, resolvedConfig) : null;

	let offset = 0;

	try {
		while (offset < sampleCount) {
			if (signal.aborted) {
				if (spectralContext) engine.cleanupContext(spectralContext);

				throw new DOMException("Aborted", "AbortError");
			}

			const chunkFrames = Math.min(DEFAULT_CHUNK_SIZE, sampleCount - offset);

			const channelBuffers = await Promise.all(Array.from({ length: channelCount }, (_, ch) => readSamples(ch, startSample + offset, chunkFrames)));

			scanSamples(channelBuffers, chunkFrames, scanContext);

			if (spectralContext) {
				engine.submitChunk(scanContext.monoBuffer, chunkFrames, spectralContext);
			}

			offset += chunkFrames;

			await yieldControl();
		}
	} catch (error: unknown) {
		if (spectralContext) engine.cleanupContext(spectralContext);

		throw error;
	}

	const { overallPeak, overallRms, truePeak } = finalizeScan(scanContext);

	const loudnessData = loudness ? computeLoudnessData(scanContext, overallPeak, overallRms, computeTruePeak ? truePeak : undefined) : null;

	const spectrogramTexture = spectralContext ? engine.finalize(sampleQuery, spectralContext, resolvedConfig).spectrogramTexture : null;

	const resolvedOptions: ResolvedPipelineOptions = {
		...options,
		config: resolvedConfig,
	};

	return {
		waveformBuffer: scanContext.waveformBuffer,
		waveformPointCount: scanContext.state.pointIndex,
		loudnessData,
		spectrogramTexture,
		options: resolvedOptions,
	};
}
