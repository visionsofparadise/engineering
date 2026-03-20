import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { StreamContext } from "../../node";
import { applyBandpass } from "../../utils/apply-bandpass";
import { MixedRadixFft } from "../../utils/mixed-radix-fft";
import { filterOnnxProviders } from "../../utils/onnx-providers";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { resampleDirect } from "../../utils/resample-direct";
import { stft7680IntoTensor, istft7680FromTensor } from "./utils/stft";

export const schema = z.object({
	modelPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", accept: ".onnx", binary: "Kim_Vocal_2", download: "https://huggingface.co/seanghay/uvr_models" })
		.describe("MDX-Net vocal isolation model (.onnx)"),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	onnxAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "onnx-addon", download: "https://github.com/visionsofparadise/onnx-runtime-addon" })
		.describe("ONNX Runtime native addon"),
	highPass: z.number().min(20).max(500).multipleOf(10).default(80).describe("High Pass"),
	lowPass: z.number().min(1000).max(22050).multipleOf(100).default(20000).describe("Low Pass"),
});

export interface DialogueIsolateProperties extends z.infer<typeof schema>, TransformNodeProperties {}

const SAMPLE_RATE = 44100;
const N_FFT = 7680;
const HOP_SIZE = 1024;
const DIM_F = 3072;
const DIM_T = 256;
const COMPENSATE = 1.009;
const SEGMENT_SAMPLES = N_FFT + (DIM_T - 1) * HOP_SIZE; // 268800
const OVERLAP = 0.25;
const TRANSITION_POWER = 1.0;
const CHANNEL_STRIDE = DIM_F * DIM_T;

export class DialogueIsolateStream extends BufferedTransformStream<DialogueIsolateProperties> {
	private session!: OnnxSession;
	private fftInstance: MixedRadixFft;

	constructor(properties: DialogueIsolateProperties) {
		super(properties);
		this.fftInstance = new MixedRadixFft(N_FFT);
	}

	override _setup(context: StreamContext): void {
		const props = this.properties;

		this.session = createOnnxSession(props.onnxAddonPath, props.modelPath, { executionProviders: filterOnnxProviders(context.executionProviders) });
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const props = this.properties;
		const session = this.session;

		const frames = buffer.frames;
		const channels = buffer.channels;
		const chunk = await buffer.read(0, frames);

		const left = chunk.samples[0] ?? new Float32Array(frames);
		const right = channels >= 2 ? (chunk.samples[1] ?? left) : left;
		const isMono = left === right;

		let left44k = left;
		let right44k = right;

		if ((this.sampleRate ?? 44100) !== SAMPLE_RATE) {
			const resampled = await resampleDirect(props.ffmpegPath, [left, right], this.sampleRate ?? 44100, SAMPLE_RATE);

			left44k = resampled[0] ?? left;
			right44k = resampled[1] ?? right;
		}

		const samples44k = left44k.length;

		const stride = Math.round((1 - OVERLAP) * SEGMENT_SAMPLES);
		const outputLeft = new Float32Array(samples44k);
		const outputRight = new Float32Array(samples44k);
		const sumWeight = new Float32Array(samples44k);

		const weight = new Float32Array(SEGMENT_SAMPLES);
		const half = SEGMENT_SAMPLES / 2;

		for (let index = 0; index < half; index++) {
			weight[index] = Math.pow((index + 1) / half, TRANSITION_POWER);
		}

		for (let index = 0; index < half; index++) {
			weight[SEGMENT_SAMPLES - 1 - index] = weight[index] ?? 0;
		}

		const fft = this.fftInstance;
		const segLeft = new Float32Array(SEGMENT_SAMPLES);
		const segRight = new Float32Array(SEGMENT_SAMPLES);
		const inputData = new Float32Array(4 * CHANNEL_STRIDE);
		const segOutLeft = new Float32Array(SEGMENT_SAMPLES);
		const segOutRight = new Float32Array(SEGMENT_SAMPLES);
		const istftWindowSum = new Float32Array(SEGMENT_SAMPLES);

		for (let offset = 0; offset < samples44k; offset += stride) {
			const chunkLen = Math.min(SEGMENT_SAMPLES, samples44k - offset);

			segLeft.fill(0);

			for (let index = 0; index < chunkLen; index++) {
				segLeft[index] = left44k[offset + index] ?? 0;
			}

			inputData.fill(0);
			stft7680IntoTensor(fft, segLeft, inputData, 0 * CHANNEL_STRIDE, 2 * CHANNEL_STRIDE);

			if (isMono) {
				inputData.copyWithin(1 * CHANNEL_STRIDE, 0 * CHANNEL_STRIDE, 1 * CHANNEL_STRIDE);
				inputData.copyWithin(3 * CHANNEL_STRIDE, 2 * CHANNEL_STRIDE, 3 * CHANNEL_STRIDE);
			} else {
				segRight.fill(0);

				for (let index = 0; index < chunkLen; index++) {
					segRight[index] = right44k[offset + index] ?? 0;
				}

				stft7680IntoTensor(fft, segRight, inputData, 1 * CHANNEL_STRIDE, 3 * CHANNEL_STRIDE);
			}

			const result = session.run({
				input: { data: inputData, dims: [1, 4, DIM_F, DIM_T] },
			});

			const modelOutput = result.output;

			if (!modelOutput) continue;

			segOutLeft.fill(0);
			istftWindowSum.fill(0);
			istft7680FromTensor(fft, modelOutput.data, 0 * CHANNEL_STRIDE, 2 * CHANNEL_STRIDE, DIM_T, COMPENSATE, segOutLeft, istftWindowSum);

			if (isMono) {
				segOutRight.set(segOutLeft);
			} else {
				segOutRight.fill(0);
				istftWindowSum.fill(0);
				istft7680FromTensor(fft, modelOutput.data, 1 * CHANNEL_STRIDE, 3 * CHANNEL_STRIDE, DIM_T, COMPENSATE, segOutRight, istftWindowSum);
			}

			for (let index = 0; index < chunkLen; index++) {
				const wt = weight[index] ?? 1;

				outputLeft[offset + index] = (outputLeft[offset + index] ?? 0) + (segOutLeft[index] ?? 0) * wt;
				outputRight[offset + index] = (outputRight[offset + index] ?? 0) + (segOutRight[index] ?? 0) * wt;
				sumWeight[offset + index] = (sumWeight[offset + index] ?? 0) + wt;
			}
		}

		for (let index = 0; index < samples44k; index++) {
			const sw = sumWeight[index] ?? 1;

			if (sw > 0) {
				outputLeft[index] = (outputLeft[index] ?? 0) / sw;
				outputRight[index] = (outputRight[index] ?? 0) / sw;
			}
		}

		let finalLeft: Float32Array = outputLeft;
		let finalRight: Float32Array = outputRight;

		if ((this.sampleRate ?? 44100) !== SAMPLE_RATE) {
			const resampled = await resampleDirect(props.ffmpegPath, [outputLeft, outputRight], SAMPLE_RATE, this.sampleRate ?? 44100);

			finalLeft = resampled[0] ?? outputLeft;
			finalRight = resampled[1] ?? outputRight;
		}

		const outputChannels: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const out = new Float32Array(frames);
			const srcCh = Math.min(ch, 1);
			const src = srcCh === 0 ? finalLeft : finalRight;

			out.set(src.subarray(0, Math.min(src.length, frames)));
			outputChannels.push(out);
		}

		applyBandpass(outputChannels, this.sampleRate ?? 44100, props.highPass, props.lowPass);

		await buffer.write(0, outputChannels);
	}
}

export class DialogueIsolateNode extends TransformNode<DialogueIsolateProperties> {
	static override readonly moduleName = "Dialogue Isolate";
	static override readonly moduleDescription = "Isolate dialogue from background using MDX-Net vocal separation";
	static override readonly schema = schema;

	static override is(value: unknown): value is DialogueIsolateNode {
		return TransformNode.is(value) && value.type[2] === "dialogue-isolate";
	}

	override readonly type = ["buffered-audio-node", "transform", "dialogue-isolate"] as const;

	constructor(properties: DialogueIsolateProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): DialogueIsolateStream {
		return new DialogueIsolateStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DialogueIsolateProperties>): DialogueIsolateNode {
		return new DialogueIsolateNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function dialogueIsolate(options: { modelPath: string; ffmpegPath: string; onnxAddonPath?: string; highPass?: number; lowPass?: number; id?: string }): DialogueIsolateNode {
	return new DialogueIsolateNode({
		modelPath: options.modelPath,
		ffmpegPath: options.ffmpegPath,
		onnxAddonPath: options.onnxAddonPath ?? "",
		highPass: options.highPass ?? 80,
		lowPass: options.lowPass ?? 20000,
		id: options.id,
	});
}

