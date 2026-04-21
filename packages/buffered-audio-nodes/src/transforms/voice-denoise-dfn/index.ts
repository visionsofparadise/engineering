import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { resampleDirect } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { filterOnnxProviders } from "../../utils/onnx-providers";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { DFN3_SAMPLE_RATE, processDfnFrames } from "./utils/dfn";

export const schema = z.object({
	modelPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", accept: ".onnx", binary: "dfn3", download: "https://github.com/yuyun2000/SpeechDenoiser" })
		.describe("DeepFilterNet3 48 kHz denoiser model (.onnx)"),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	onnxAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "onnx-addon", download: "https://github.com/visionsofparadise/onnx-runtime-addon" })
		.describe("ONNX Runtime native addon"),
	attenuation: z.number().min(0).max(100).default(30).describe("Attenuation cap in dB. Maps to the ONNX `atten_lim_db` input; 0 = no cap"),
	threshold: z.number().min(-100).max(0).default(-60).describe("Post-mask time-domain dB gate; output samples below this dBFS amplitude are zeroed"),
});

export interface VoiceDenoiseDfnProperties extends z.infer<typeof schema>, TransformNodeProperties {}

export class VoiceDenoiseDfnStream extends BufferedTransformStream<VoiceDenoiseDfnProperties> {
	private session?: OnnxSession;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		this.session = createOnnxSession(this.properties.onnxAddonPath, this.properties.modelPath, { executionProviders: filterOnnxProviders(context.executionProviders) });

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.session) throw new Error("voice-denoise-dfn: stream not set up");

		const session = this.session;
		const frames = buffer.frames;
		const channels = buffer.channels;
		const chunk = await buffer.read(0, frames);
		const sourceRate = this.sampleRate ?? 44100;

		const outputChannels: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const channel = chunk.samples[ch];

			if (!channel) {
				outputChannels.push(new Float32Array(frames));
				continue;
			}

			let input48k: Float32Array = channel;

			if (sourceRate !== DFN3_SAMPLE_RATE) {
				const resampled = await resampleDirect(this.properties.ffmpegPath, [channel], sourceRate, DFN3_SAMPLE_RATE);

				input48k = resampled[0] ?? channel;
			}

			const denoised48k = processDfnFrames(input48k, session, this.properties.attenuation, this.properties.threshold);

			let output: Float32Array = denoised48k;

			if (sourceRate !== DFN3_SAMPLE_RATE) {
				const resampled = await resampleDirect(this.properties.ffmpegPath, [denoised48k], DFN3_SAMPLE_RATE, sourceRate);

				output = resampled[0] ?? denoised48k;
			}

			const finalOutput = new Float32Array(frames);

			finalOutput.set(output.subarray(0, Math.min(output.length, frames)));
			outputChannels.push(finalOutput);
		}

		await buffer.write(0, outputChannels);
	}

	override _teardown(): void {
		this.session?.dispose();
		this.session = undefined;
	}
}

export class VoiceDenoiseDfnNode extends TransformNode<VoiceDenoiseDfnProperties> {
	static override readonly moduleName = "Voice Denoise (DFN3)";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Remove background noise from speech using DeepFilterNet3 (48 kHz full-band CRN)";
	static override readonly schema = schema;

	static override is(value: unknown): value is VoiceDenoiseDfnNode {
		return TransformNode.is(value) && value.type[2] === "voice-denoise-dfn";
	}

	override readonly type = ["buffered-audio-node", "transform", "voice-denoise-dfn"] as const;

	constructor(properties: VoiceDenoiseDfnProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): VoiceDenoiseDfnStream {
		return new VoiceDenoiseDfnStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<VoiceDenoiseDfnProperties>): VoiceDenoiseDfnNode {
		return new VoiceDenoiseDfnNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function voiceDenoiseDfn(options: {
	modelPath: string;
	ffmpegPath: string;
	onnxAddonPath?: string;
	attenuation?: number;
	threshold?: number;
	id?: string;
}): VoiceDenoiseDfnNode {
	return new VoiceDenoiseDfnNode({
		modelPath: options.modelPath,
		ffmpegPath: options.ffmpegPath,
		onnxAddonPath: options.onnxAddonPath ?? "",
		attenuation: options.attenuation ?? 30,
		threshold: options.threshold ?? -60,
		id: options.id,
	});
}
