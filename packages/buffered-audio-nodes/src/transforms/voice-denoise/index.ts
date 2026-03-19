import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { AudioChunk, ExecutionProvider, StreamContext } from "../../node";
import { initFftBackend, type FftBackend } from "../../utils/fft-backend";
import { filterOnnxProviders } from "../../utils/onnx-providers";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { resampleDirect } from "../../utils/resample-direct";
import { istft, stft } from "../../utils/stft";

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
const BLOCK_LEN = 512;
const BLOCK_SHIFT = 128;
const FFT_BINS = BLOCK_LEN / 2 + 1; // 257
const LSTM_UNITS = 128;

export class VoiceDenoiseStream extends BufferedTransformStream<VoiceDenoiseProperties> {
	private session1?: OnnxSession;
	private session2?: OnnxSession;
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };
	private executionProviders: ReadonlyArray<ExecutionProvider> = [];

	override setup(input: ReadableStream<AudioChunk>, context: StreamContext): ReadableStream<AudioChunk> {
		this.executionProviders = context.executionProviders;

		const cpuProviders = context.executionProviders.filter((ep) => ep !== "gpu");
		const fft = initFftBackend(cpuProviders.length > 0 ? cpuProviders : ["cpu"], this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super.setup(input, context);
	}

	private ensureSessions(): { session1: OnnxSession; session2: OnnxSession } {
		if (this.session1 && this.session2) return { session1: this.session1, session2: this.session2 };
		const props = this.properties;
		const onnxProviders = filterOnnxProviders(this.executionProviders);

		this.session1 = createOnnxSession(props.onnxAddonPath, props.modelPath1, { executionProviders: onnxProviders });
		this.session2 = createOnnxSession(props.onnxAddonPath, props.modelPath2, { executionProviders: onnxProviders });

		return { session1: this.session1, session2: this.session2 };
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const props = this.properties;
		const frames = buffer.frames;
		const channels = buffer.channels;

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			let input16k: Float32Array = channel;

			if ((this.sampleRate ?? 44100) !== DTLN_SAMPLE_RATE) {
				const resampled = await resampleDirect(props.ffmpegPath, [channel], this.sampleRate ?? 44100, DTLN_SAMPLE_RATE);

				input16k = resampled[0] ?? channel;
			}

			const denoised16k = this.processDtln(input16k);

			let output: Float32Array = denoised16k;

			if ((this.sampleRate ?? 44100) !== DTLN_SAMPLE_RATE) {
				const resampled = await resampleDirect(props.ffmpegPath, [denoised16k], DTLN_SAMPLE_RATE, this.sampleRate ?? 44100);

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

	private processDtln(signal: Float32Array): Float32Array {
		const { session1, session2 } = this.ensureSessions();

		const originalLength = signal.length;

		if (originalLength < BLOCK_LEN) {
			const padded = new Float32Array(BLOCK_LEN);

			padded.set(signal);
			signal = padded;
		}

		const totalFrames = signal.length;
		const output = new Float32Array(totalFrames);

		const stateSize = 1 * 2 * LSTM_UNITS * 2;
		let states1 = new Float32Array(stateSize);
		let states2 = new Float32Array(stateSize);

		const inputBuffer = new Float32Array(BLOCK_LEN);
		const magnitude = new Float32Array(FFT_BINS);
		const maskedReal = new Float32Array(FFT_BINS);
		const maskedImag = new Float32Array(FFT_BINS);
		const maskedStft = {
			real: [maskedReal],
			imag: [maskedImag],
			frames: 1,
			fftSize: BLOCK_LEN,
		};
		const stftOutput = { real: [new Float32Array(FFT_BINS)], imag: [new Float32Array(FFT_BINS)] };

		for (let offset = 0; offset + BLOCK_LEN <= totalFrames; offset += BLOCK_SHIFT) {
			inputBuffer.set(signal.subarray(offset, offset + BLOCK_LEN));

			const stftResult = stft(inputBuffer, BLOCK_LEN, BLOCK_LEN, stftOutput, this.fftBackend, this.fftAddonOptions);
			const realFrame = stftResult.real[0];
			const imagFrame = stftResult.imag[0];

			if (!realFrame || !imagFrame) continue;

			for (let bin = 0; bin < FFT_BINS; bin++) {
				const re = realFrame[bin] ?? 0;
				const im = imagFrame[bin] ?? 0;

				magnitude[bin] = Math.log(Math.sqrt(re * re + im * im) + 1e-7);
			}

			const result1 = session1.run({
				input_2: { data: magnitude, dims: [1, 1, FFT_BINS] },
				input_3: { data: states1, dims: [1, 2, LSTM_UNITS, 2] },
			});

			const mask = result1.activation_2;

			states1 = result1.tf_op_layer_stack_2 ? new Float32Array(result1.tf_op_layer_stack_2.data) : states1;

			if (!mask) continue;

			for (let bin = 0; bin < FFT_BINS; bin++) {
				const maskVal = mask.data[bin] ?? 0;

				maskedReal[bin] = (realFrame[bin] ?? 0) * maskVal;
				maskedImag[bin] = (imagFrame[bin] ?? 0) * maskVal;
			}

			const maskedTimeDomain = istft(maskedStft, BLOCK_LEN, BLOCK_LEN, this.fftBackend, this.fftAddonOptions);

			const result2 = session2.run({
				input_4: { data: maskedTimeDomain, dims: [1, 1, BLOCK_LEN] },
				input_5: { data: states2, dims: [1, 2, LSTM_UNITS, 2] },
			});

			const denoisedFrame = result2.conv1d_3;

			states2 = result2.tf_op_layer_stack_5 ? new Float32Array(result2.tf_op_layer_stack_5.data) : states2;

			if (!denoisedFrame) continue;

			for (let index = 0; index < BLOCK_LEN; index++) {
				const outIdx = offset + index;

				if (outIdx < totalFrames) {
					output[outIdx] = (output[outIdx] ?? 0) + (denoisedFrame.data[index] ?? 0);
				}
			}
		}

		return originalLength < output.length ? output.subarray(0, originalLength) : output;
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
