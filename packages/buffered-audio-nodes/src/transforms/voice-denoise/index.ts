import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "buffered-audio-nodes-core";
import { initFftBackend, resampleDirect, type FftBackend } from "buffered-audio-nodes-utils";
import { filterOnnxProviders } from "../../utils/onnx-providers";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { processDtlnFrames } from "./utils/dtln";

export const schema = z.object({
	modelPath1: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", accept: ".onnx", binary: "dtln-model_1", download: "https://github.com/breizhn/DTLN" })
		.describe("DTLN magnitude mask model (.onnx)"),
	modelPath2: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", accept: ".onnx", binary: "dtln-model_2", download: "https://github.com/breizhn/DTLN" })
		.describe("DTLN time-domain model (.onnx)"),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	onnxAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "onnx-addon", download: "https://github.com/visionsofparadise/onnx-runtime-addon" })
		.describe("ONNX Runtime native addon"),
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

export interface VoiceDenoiseProperties extends z.infer<typeof schema>, TransformNodeProperties {}

const DTLN_SAMPLE_RATE = 16000;

export class VoiceDenoiseStream extends BufferedTransformStream<VoiceDenoiseProperties> {
	private session1!: OnnxSession;
	private session2!: OnnxSession;
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const onnxProviders = filterOnnxProviders(context.executionProviders);

		this.session1 = createOnnxSession(this.properties.onnxAddonPath, this.properties.modelPath1, { executionProviders: onnxProviders });
		this.session2 = createOnnxSession(this.properties.onnxAddonPath, this.properties.modelPath2, { executionProviders: onnxProviders });

		const cpuProviders = context.executionProviders.filter((ep) => ep !== "gpu");
		const fft = initFftBackend(cpuProviders.length > 0 ? cpuProviders : ["cpu"], this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			let input16k: Float32Array = channel;

			if ((this.sampleRate ?? 44100) !== DTLN_SAMPLE_RATE) {
				const resampled = await resampleDirect(this.properties.ffmpegPath, [channel], this.sampleRate ?? 44100, DTLN_SAMPLE_RATE);

				input16k = resampled[0] ?? channel;
			}

			const denoised16k = processDtlnFrames(input16k, this.session1, this.session2, this.fftBackend, this.fftAddonOptions);

			let output: Float32Array = denoised16k;

			if ((this.sampleRate ?? 44100) !== DTLN_SAMPLE_RATE) {
				const resampled = await resampleDirect(this.properties.ffmpegPath, [denoised16k], DTLN_SAMPLE_RATE, this.sampleRate ?? 44100);

				output = resampled[0] ?? denoised16k;
			}

			const finalOutput = new Float32Array(frames);

			finalOutput.set(output.subarray(0, Math.min(output.length, frames)));

			const allChannels: Array<Float32Array> = [];

			for (let writeCh = 0; writeCh < channels; writeCh++) {
				allChannels.push(writeCh === ch ? finalOutput : (chunk.samples[writeCh] ?? new Float32Array(frames)));
			}

			await buffer.write(0, allChannels);
		}
	}
}

export class VoiceDenoiseNode extends TransformNode<VoiceDenoiseProperties> {
	static override readonly moduleName = "Voice Denoise";
	static override readonly moduleDescription = "Remove background noise from speech using DTLN neural network";
	static override readonly schema = schema;
	static override is(value: unknown): value is VoiceDenoiseNode {
		return TransformNode.is(value) && value.type[2] === "voice-denoise";
	}

	override readonly type = ["buffered-audio-node", "transform", "voice-denoise"] as const;

	constructor(properties: VoiceDenoiseProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): VoiceDenoiseStream {
		return new VoiceDenoiseStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<VoiceDenoiseProperties>): VoiceDenoiseNode {
		return new VoiceDenoiseNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function voiceDenoise(options: {
	modelPath1: string;
	modelPath2: string;
	ffmpegPath: string;
	onnxAddonPath?: string;
	vkfftAddonPath?: string;
	fftwAddonPath?: string;
	id?: string;
}): VoiceDenoiseNode {
	return new VoiceDenoiseNode({
		modelPath1: options.modelPath1,
		modelPath2: options.modelPath2,
		ffmpegPath: options.ffmpegPath,
		onnxAddonPath: options.onnxAddonPath ?? "",
		vkfftAddonPath: options.vkfftAddonPath ?? "",
		fftwAddonPath: options.fftwAddonPath ?? "",
		id: options.id,
	});
}
