import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "buffered-audio-nodes-core";
import { initFftBackend, istft, replaceChannel, stft, type FftBackend } from "buffered-audio-nodes-utils";
import { interpolateTfRegion, type SpectralRegion } from "./utils/interpolation";


export const schema = z.object({
	method: z.enum(["ar", "nmf"]).default("ar").describe("Method"),
	vkfftAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "vkfft-addon", download: "https://github.com/visionsofparadise/vkfft-addon" })
		.describe("VkFFT native addon — GPU FFT acceleration"),
	fftwAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "fftw-addon", download: "https://github.com/visionsofparadise/fftw-addon" })
		.describe("FFTW native addon — CPU FFT acceleration"),
});

export interface SpectralRepairProperties extends z.infer<typeof schema>, TransformNodeProperties {
	readonly regions: Array<SpectralRegion>;
}

/**
 * Reconstructs damaged or missing regions in the spectrogram using
 * time-frequency domain AR interpolation.
 *
 * @see Mokry, O., Balusik, P., Rajmic, P. (2024). "Janssen 2.0: Audio Inpainting in the
 *   Time-frequency Domain." arXiv:2409.06392. https://arxiv.org/abs/2409.06392
 */
export class SpectralRepairStream extends BufferedTransformStream<SpectralRepairProperties> {
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const sampleRate = this.sampleRate ?? 44100;
		const channels = buffer.channels;
		const frames = buffer.frames;
		const fftSize = 2048;
		const hopSize = fftSize / 4;
		const halfSize = fftSize / 2 + 1;
		const paddedLength = Math.max(frames, fftSize);
		const numStftFrames = Math.floor((paddedLength - fftSize) / hopSize) + 1;
		const stftOutput = {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
		};

		const chunk = await buffer.read(0, frames);

		for (let ch = 0; ch < channels; ch++) {
			let channel = chunk.samples[ch];

			if (!channel) continue;

			if (channel.length < fftSize) {
				const padded = new Float32Array(fftSize);

				padded.set(channel);
				channel = padded;
			}

			const stftResult = stft(channel, fftSize, hopSize, stftOutput, this.fftBackend, this.fftAddonOptions);
			const freqPerBin = sampleRate / fftSize;
			const timePerFrame = hopSize / sampleRate;

			for (const region of this.properties.regions) {
				const startFrame = Math.floor(region.startTime / timePerFrame);
				const endFrame = Math.ceil(region.endTime / timePerFrame);
				const startBin = Math.floor(region.startFreq / freqPerBin);
				const endBin = Math.ceil(region.endFreq / freqPerBin);

				interpolateTfRegion(stftResult.real, stftResult.imag, startFrame, endFrame, startBin, endBin);
			}

			const repaired = istft(stftResult, hopSize, paddedLength, this.fftBackend, this.fftAddonOptions).subarray(0, frames);

			await buffer.write(0, replaceChannel(chunk, ch, repaired, channels));
		}
	}
}

export class SpectralRepairNode extends TransformNode<SpectralRepairProperties> {
	static override readonly moduleName = "Spectral Repair";
	static override readonly moduleDescription = "Repair spectral artifacts by interpolating from surrounding content";
	static override readonly schema = schema;
	static override is(value: unknown): value is SpectralRepairNode {
		return TransformNode.is(value) && value.type[2] === "spectral-repair";
	}

	override readonly type = ["buffered-audio-node", "transform", "spectral-repair"] as const;

	constructor(properties: SpectralRepairProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): SpectralRepairStream {
		return new SpectralRepairStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<SpectralRepairProperties>): SpectralRepairNode {
		return new SpectralRepairNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function spectralRepair(
	regions: Array<SpectralRegion>,
	options?: {
		method?: "ar" | "nmf";
		vkfftAddonPath?: string;
		fftwAddonPath?: string;
		id?: string;
	},
): SpectralRepairNode {
	return new SpectralRepairNode({
		regions,
		method: options?.method ?? "ar",
		vkfftAddonPath: options?.vkfftAddonPath ?? "",
		fftwAddonPath: options?.fftwAddonPath ?? "",
		id: options?.id,
	});
}
