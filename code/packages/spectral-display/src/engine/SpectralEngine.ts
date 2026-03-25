import type { RequiredProperties } from "../utils/RequiredProperties";
import { computeBandMappings, type FrequencyScale } from "./band-mapping";
import { generateColormapBuffer, resolveColormap, resolveWaveformColor, type ColormapDefinition } from "./colormap";
import { getMaxFftSize } from "./device";
import { FFT_PIPELINE_SHADER, SPECTROGRAM_VISUALIZE_SHADER } from "./shaders";

export interface Dimensions {
	width: number;
	height: number;
}

export interface SpectralConfig {
	fftSize: number;
	frequencyScale: FrequencyScale;
	dbRange: [number, number];
	colormap: "lava" | "viridis" | ColormapDefinition;
	waveformColor: [number, number, number];
	device: GPUDevice;
	signal: AbortSignal;
	spectrogram: boolean;
	loudness: boolean;
	truePeak: boolean;
	/** Hop overlap factor — higher = more time resolution. Default 4. */
	hopOverlap: number;
}

export interface SpectralResult extends Dimensions {
	spectrogramTexture: GPUTexture;
}

interface CachedPipelines {
	fftPipeline: GPUComputePipeline;
	spectrogramPipeline: GPUComputePipeline;
}

export interface SpectralProcessContext {
	fftSize: number;
	hopSize: number;
	totalFrames: number;
	overlapBuffer: Float32Array;
	overlapCount: number;
	hopOffset: number;
	magnitudeBuffer: GPUBuffer;
	bandMappingBuffer: GPUBuffer;
	colormapBuffer: GPUBuffer;
	inputBuffer: GPUBuffer;
	uniformBuffer: GPUBuffer;
	pipelines: CachedPipelines;
	numBands: number;
	isLinear: boolean;
}

const DEFAULT_NON_LINEAR_BANDS = 512;
const HOP_OVERLAP_FACTOR = 4;
const MAX_INPUT_BUFFER_SAMPLES = 131072;

async function checkShaderCompilation(module: GPUShaderModule, label: string): Promise<void> {
	const info = await module.getCompilationInfo();
	const errors = info.messages.filter((entry) => entry.type === "error");

	if (errors.length > 0) {
		const details = errors.map((entry) => entry.message).join("\n");

		throw new Error(`Shader compilation failed (${label}):\n${details}`);
	}
}

export function resolveConfig(config: RequiredProperties<SpectralConfig, "device" | "signal">): SpectralConfig {
	const colormapInput = config.colormap ?? "lava";
	const resolvedColormap = resolveColormap(colormapInput);
	const waveformColor = resolveWaveformColor(colormapInput, config.waveformColor);

	return {
		...config,
		fftSize: config.fftSize ?? 4096,
		frequencyScale: config.frequencyScale ?? "log",
		dbRange: config.dbRange ?? [-120, 0],
		colormap: resolvedColormap,
		waveformColor,
		spectrogram: config.spectrogram ?? true,
		loudness: config.loudness ?? true,
		truePeak: config.truePeak ?? true,
		hopOverlap: config.hopOverlap ?? HOP_OVERLAP_FACTOR,
	};
}

function makeCacheKey(fftSize: number, frequencyScale: FrequencyScale): string {
	return `${fftSize}:${frequencyScale}`;
}

export class SpectralEngine {
	private readonly device: GPUDevice;
	private readonly pipelineCache = new Map<string, CachedPipelines>();

	constructor(device: GPUDevice) {
		this.device = device;
	}

	async prepare(sampleCount: number, sampleRate: number, config: SpectralConfig): Promise<SpectralProcessContext> {
		const { fftSize: requestedFftSize, frequencyScale } = config;

		const maxFft = getMaxFftSize(this.device);
		const fftSize = Math.min(requestedFftSize, maxFft);

		if (sampleCount < fftSize) {
			throw new Error(`Audio segment too short for FFT size ${fftSize} — need at least ${fftSize} samples, got ${sampleCount}`);
		}

		const isLinear = frequencyScale === "linear";
		const numBands = isLinear ? fftSize / 2 + 1 : DEFAULT_NON_LINEAR_BANDS;
		const hopOverlap = config.hopOverlap;
		const hopSize = Math.max(1, Math.floor(fftSize / hopOverlap));
		const totalFrames = Math.floor((sampleCount - fftSize) / hopSize) + 1;
		const bandMappingData = computeBandMappings(frequencyScale, numBands, sampleRate, fftSize);
		const resolvedColormap = typeof config.colormap === "string" ? resolveColormap(config.colormap) : config.colormap;
		const colormapData = generateColormapBuffer(resolvedColormap);
		const pipelines = await this.getOrCreatePipelines(fftSize, frequencyScale);

		const magnitudeBuffer = this.device.createBuffer({
			size: totalFrames * numBands * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		});

		const bandMappingBuffer = this.device.createBuffer({
			size: Math.max(16, bandMappingData.byteLength),
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});

		new Float32Array(bandMappingBuffer.getMappedRange(0, bandMappingData.byteLength)).set(bandMappingData);
		bandMappingBuffer.unmap();

		const colormapPackedData = new Uint32Array(256);

		for (let index = 0; index < 256; index++) {
			const offset = index * 4;
			const red = colormapData[offset] ?? 0;
			const green = colormapData[offset + 1] ?? 0;
			const blue = colormapData[offset + 2] ?? 0;
			const alpha = colormapData[offset + 3] ?? 0;

			colormapPackedData[index] = red | (green << 8) | (blue << 16) | (alpha << 24);
		}

		const colormapBuffer = this.device.createBuffer({
			size: colormapPackedData.byteLength,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});

		new Uint32Array(colormapBuffer.getMappedRange()).set(colormapPackedData);
		colormapBuffer.unmap();

		const inputBuffer = this.device.createBuffer({
			size: (MAX_INPUT_BUFFER_SAMPLES + fftSize) * 4,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});

		const uniformBuffer = this.device.createBuffer({
			size: 32,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		return {
			fftSize,
			hopSize,
			totalFrames,
			overlapBuffer: new Float32Array(fftSize),
			overlapCount: 0,
			hopOffset: 0,
			magnitudeBuffer,
			bandMappingBuffer,
			colormapBuffer,
			inputBuffer,
			uniformBuffer,
			pipelines,
			numBands,
			isLinear,
		};
	}

	submitChunk(monoSamples: Float32Array, chunkLength: number, context: SpectralProcessContext): void {
		const { fftSize, hopSize, totalFrames, overlapBuffer } = context;

		// Prepend overlap from previous chunk
		const totalSamples = context.overlapCount + chunkLength;
		const combined = new Float32Array(totalSamples);

		if (context.overlapCount > 0) {
			combined.set(overlapBuffer.subarray(0, context.overlapCount));
		}

		combined.set(monoSamples.subarray(0, chunkLength), context.overlapCount);

		// How many hops fit in this combined buffer
		let localOffset = 0;

		while (localOffset + fftSize <= totalSamples && context.hopOffset < totalFrames) {
			const maxHops = Math.floor((totalSamples - localOffset - fftSize) / hopSize) + 1;
			const remainingHops = totalFrames - context.hopOffset;
			const hopsInBatch = Math.min(maxHops, remainingHops, Math.floor((MAX_INPUT_BUFFER_SAMPLES - fftSize) / hopSize) + 1);

			if (hopsInBatch <= 0) break;

			const batchSamples = (hopsInBatch - 1) * hopSize + fftSize;
			const batchData = combined.subarray(localOffset, localOffset + batchSamples);

			this.device.queue.writeBuffer(context.inputBuffer, 0, batchData.buffer, batchData.byteOffset, batchData.byteLength);

			const uniformData = new Uint32Array(8);

			uniformData[0] = fftSize;
			uniformData[1] = context.hopOffset;
			uniformData[2] = context.numBands;
			uniformData[3] = context.isLinear ? 0 : 1;
			uniformData[4] = hopSize;

			this.device.queue.writeBuffer(context.uniformBuffer, 0, uniformData);

			const fftBindGroup = this.device.createBindGroup({
				layout: context.pipelines.fftPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: context.inputBuffer } },
					{ binding: 1, resource: { buffer: context.magnitudeBuffer } },
					{ binding: 2, resource: { buffer: context.bandMappingBuffer } },
					{ binding: 3, resource: { buffer: context.uniformBuffer } },
				],
			});

			const commandEncoder = this.device.createCommandEncoder();
			const computePass = commandEncoder.beginComputePass();

			computePass.setPipeline(context.pipelines.fftPipeline);
			computePass.setBindGroup(0, fftBindGroup);
			computePass.dispatchWorkgroups(hopsInBatch);
			computePass.end();

			this.device.queue.submit([commandEncoder.finish()]);

			localOffset += hopsInBatch * hopSize;
			context.hopOffset += hopsInBatch;
		}

		// Save remaining samples as overlap for next chunk
		const consumed = localOffset;
		const remaining = totalSamples - consumed;

		if (remaining > 0) {
			overlapBuffer.set(combined.subarray(consumed, consumed + remaining));
		}

		context.overlapCount = remaining;
	}

	finalize(dimensions: { width: number; height: number }, context: SpectralProcessContext, config: SpectralConfig): SpectralResult {
		const { width, height } = dimensions;

		const spectrogramTexture = this.device.createTexture({
			size: dimensions,
			format: "rgba8unorm",
			usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
		});

		const spectrogramUniformData = new ArrayBuffer(24);
		const spectrogramUniforms = new DataView(spectrogramUniformData);

		spectrogramUniforms.setUint32(0, context.totalFrames, true);
		spectrogramUniforms.setUint32(4, context.numBands, true);
		spectrogramUniforms.setUint32(8, width, true);
		spectrogramUniforms.setUint32(12, height, true);
		spectrogramUniforms.setFloat32(16, config.dbRange[0], true);
		spectrogramUniforms.setFloat32(20, config.dbRange[1], true);

		const spectrogramUniformBuffer = this.device.createBuffer({
			size: 24,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			mappedAtCreation: true,
		});

		new Uint8Array(spectrogramUniformBuffer.getMappedRange()).set(new Uint8Array(spectrogramUniformData));
		spectrogramUniformBuffer.unmap();

		const spectrogramBindGroup = this.device.createBindGroup({
			layout: context.pipelines.spectrogramPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: context.magnitudeBuffer } },
				{ binding: 1, resource: { buffer: context.colormapBuffer } },
				{ binding: 2, resource: spectrogramTexture.createView() },
				{ binding: 3, resource: { buffer: spectrogramUniformBuffer } },
			],
		});

		const commandEncoder = this.device.createCommandEncoder();
		const computePass = commandEncoder.beginComputePass();

		computePass.setPipeline(context.pipelines.spectrogramPipeline);
		computePass.setBindGroup(0, spectrogramBindGroup);
		computePass.dispatchWorkgroups(Math.ceil(width / 64), height);
		computePass.end();

		this.device.queue.submit([commandEncoder.finish()]);

		spectrogramUniformBuffer.destroy();
		this.cleanupContext(context);

		return { spectrogramTexture, width, height };
	}

	cleanupContext(context: SpectralProcessContext): void {
		context.magnitudeBuffer.destroy();
		context.bandMappingBuffer.destroy();
		context.colormapBuffer.destroy();
		context.inputBuffer.destroy();
		context.uniformBuffer.destroy();
	}

	destroy(): void {
		this.pipelineCache.clear();
	}

	private async getOrCreatePipelines(fftSize: number, frequencyScale: FrequencyScale): Promise<CachedPipelines> {
		const cacheString = makeCacheKey(fftSize, frequencyScale);
		const cached = this.pipelineCache.get(cacheString);

		if (cached) {
			return cached;
		}

		const workgroupSize = Math.min(fftSize / 2, 256);

		const fftModule = this.device.createShaderModule({ code: FFT_PIPELINE_SHADER });
		const spectrogramModule = this.device.createShaderModule({ code: SPECTROGRAM_VISUALIZE_SHADER });

		await checkShaderCompilation(fftModule, "FFT pipeline");
		await checkShaderCompilation(spectrogramModule, "spectrogram visualization");

		const fftPipeline = this.device.createComputePipeline({
			layout: "auto",
			compute: {
				module: fftModule,
				entryPoint: "main",
				constants: {
					WORKGROUP_SIZE: workgroupSize,
					FFT_SIZE: fftSize,
				},
			},
		});

		const spectrogramPipeline = this.device.createComputePipeline({
			layout: "auto",
			compute: {
				module: spectrogramModule,
				entryPoint: "main",
			},
		});

		const pipelines: CachedPipelines = { fftPipeline, spectrogramPipeline };

		this.pipelineCache.set(cacheString, pipelines);

		return pipelines;
	}
}
