import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type TransformNodeProperties } from "..";
import type { ChunkBuffer } from "../../buffer";
import type { StreamContext } from "../../node";
import { applyBandpass } from "../../utils/apply-bandpass";
import { filterOnnxProviders } from "../../utils/onnx-providers";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { resampleDirect } from "../../utils/resample-direct";
import { computeIstftScaled, computeStftScaled, reflectPad } from "./utils/dsp";

export interface StemGains {
	readonly vocals: number;
	readonly drums: number;
	readonly bass: number;
	readonly other: number;
}

export const schema = z.object({
	modelPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", accept: ".onnx", binary: "htdemucs", download: "https://github.com/facebookresearch/demucs" })
		.describe("HTDemucs source separation model (.onnx) — requires .onnx.data file alongside"),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	onnxAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "onnx-addon", download: "https://github.com/visionsofparadise/onnx-runtime-addon" })
		.describe("ONNX Runtime native addon"),
	highPass: z.number().min(0).max(500).multipleOf(10).default(0).describe("High Pass"),
	lowPass: z.number().min(0).max(22050).multipleOf(100).default(0).describe("Low Pass"),
});

export interface MusicRebalanceProperties extends z.infer<typeof schema>, TransformNodeProperties {
	readonly stems: StemGains;
}

const HTDEMUCS_SAMPLE_RATE = 44100;
const FFT_SIZE = 4096;
const HOP_SIZE = 1024;
const SEGMENT_SAMPLES = 343980; // 7.8s at 44100Hz
const OVERLAP = 0.25;
const TRANSITION_POWER = 1.0;

export class MusicRebalanceStream extends BufferedTransformStream<MusicRebalanceProperties> {
	private session!: OnnxSession;

	override _setup(context: StreamContext): void {
		const props = this.properties;

		this.session = createOnnxSession(props.onnxAddonPath, props.modelPath, { executionProviders: filterOnnxProviders(context.executionProviders) });
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		// FIX: Don't do this indirection. Get rid of this habit throughout the codebase
		const props = this.properties;
		const session = this.session;

		const originalFrames = buffer.frames;
		const channels = buffer.channels;
		const chunk = await buffer.read(0, originalFrames);

		let left = chunk.samples[0] ?? new Float32Array(originalFrames);
		let right = channels >= 2 ? (chunk.samples[1] ?? left) : left;

		if ((this.sampleRate ?? 44100) !== HTDEMUCS_SAMPLE_RATE) {
			const resampled = await resampleDirect(props.ffmpegPath, [left, right], this.sampleRate ?? 44100, HTDEMUCS_SAMPLE_RATE);

			left = resampled[0] ?? left;
			right = resampled[1] ?? right;
		}

		const frames = left.length;

		const stereo = new Float32Array(2 * frames);

		stereo.set(left, 0);
		stereo.set(right, frames);

		let sum = 0;

		for (const sample of stereo) {
			sum += sample;
		}

		const mean = sum / stereo.length;
		let variance = 0;

		for (const sample of stereo) {
			const diff = sample - mean;

			variance += diff * diff;
		}

		const std = Math.sqrt(variance / stereo.length) || 1;

		const normalizedLeft = new Float32Array(frames);
		const normalizedRight = new Float32Array(frames);

		for (let index = 0; index < frames; index++) {
			normalizedLeft[index] = ((left[index] ?? 0) - mean) / std;
			normalizedRight[index] = ((right[index] ?? 0) - mean) / std;
		}

		const stridesamples = Math.round((1 - OVERLAP) * SEGMENT_SAMPLES);
		const stemOutputs = new Array<Float32Array>(4 * 2);

		for (let si = 0; si < 8; si++) {
			stemOutputs[si] = new Float32Array(frames);
		}

		const sumWeight = new Float32Array(frames);

		const weight = new Float32Array(SEGMENT_SAMPLES);
		const half = SEGMENT_SAMPLES / 2;

		for (let index = 0; index < half; index++) {
			weight[index] = Math.pow((index + 1) / half, TRANSITION_POWER);
		}

		for (let index = 0; index < half; index++) {
			weight[SEGMENT_SAMPLES - 1 - index] = weight[index] ?? 0;
		}

		const pad = Math.floor(HOP_SIZE / 2) * 3; // 1536
		const le = Math.ceil(SEGMENT_SAMPLES / HOP_SIZE);
		const padEnd = pad + le * HOP_SIZE - SEGMENT_SAMPLES;
		const paddedLen = SEGMENT_SAMPLES + pad + padEnd;
		const stftPadConst = FFT_SIZE / 2;
		const stftLenConst = paddedLen + FFT_SIZE;
		const nbBinsConst = FFT_SIZE / 2 + 1;
		const nbFramesConst = Math.floor((stftLenConst - FFT_SIZE) / HOP_SIZE) + 1;
		const xBinsConst = nbBinsConst - 1;
		const xFramesConst = nbFramesConst - 4;

		const segLeft = new Float32Array(SEGMENT_SAMPLES);
		const segRight = new Float32Array(SEGMENT_SAMPLES);
		const inputData = new Float32Array(2 * SEGMENT_SAMPLES);
		const xData = new Float32Array(4 * xBinsConst * xFramesConst);

		const freqRealBuffers: Array<Float32Array> = [];
		const freqImagBuffers: Array<Float32Array> = [];

		for (let frame = 0; frame < nbFramesConst; frame++) {
			freqRealBuffers.push(new Float32Array(nbBinsConst));
			freqImagBuffers.push(new Float32Array(nbBinsConst));
		}

		for (let segmentOffset = 0; segmentOffset < frames; segmentOffset += stridesamples) {
			const chunkLength = Math.min(SEGMENT_SAMPLES, frames - segmentOffset);

			segLeft.fill(0);
			segRight.fill(0);

			for (let index = 0; index < chunkLength; index++) {
				segLeft[index] = normalizedLeft[segmentOffset + index] ?? 0;
				segRight[index] = normalizedRight[segmentOffset + index] ?? 0;
			}

			const paddedLeft = reflectPad(segLeft, pad, padEnd, paddedLen);
			const paddedRight = reflectPad(segRight, pad, padEnd, paddedLen);

			const stftInputLeft = reflectPad(paddedLeft, stftPadConst, stftPadConst, stftLenConst);
			const stftInputRight = reflectPad(paddedRight, stftPadConst, stftPadConst, stftLenConst);
			const stftLeft = computeStftScaled(stftInputLeft);
			const stftRight = computeStftScaled(stftInputRight);

			xData.fill(0);

			for (let ch = 0; ch < 2; ch++) {
				const stftCh = ch === 0 ? stftLeft : stftRight;

				for (let freq = 0; freq < xBinsConst; freq++) {
					for (let frame = 0; frame < xFramesConst; frame++) {
						const realIdx = 2 * ch * xBinsConst * xFramesConst + freq * xFramesConst + frame;
						const imagIdx = (2 * ch + 1) * xBinsConst * xFramesConst + freq * xFramesConst + frame;
						const srcFrame = frame + 2;

						xData[realIdx] = stftCh.real[srcFrame]?.[freq] ?? 0;
						xData[imagIdx] = stftCh.imag[srcFrame]?.[freq] ?? 0;
					}
				}
			}

			inputData.set(segLeft, 0);
			inputData.set(segRight, SEGMENT_SAMPLES);

			const result = session.run({
				input: { data: inputData, dims: [1, 2, SEGMENT_SAMPLES] },
				x: { data: xData, dims: [1, 4, xBinsConst, xFramesConst] },
			});

			const xtOut = result.add_67 ?? result[Object.keys(result).pop() ?? ""];

			const xOut = result.output ?? result[Object.keys(result)[0] ?? ""];

			for (let source = 0; source < 4; source++) {
				for (let ch = 0; ch < 2; ch++) {
					const xtIndex = source * 2 * SEGMENT_SAMPLES + ch * SEGMENT_SAMPLES;

					for (let frame = 0; frame < nbFramesConst; frame++) {
						freqRealBuffers[frame]?.fill(0);
						freqImagBuffers[frame]?.fill(0);
					}

					if (xOut) {
						const srcCh = ch;
						const baseOffset = source * 4 * xBinsConst * xFramesConst;

						for (let freq = 0; freq < xBinsConst; freq++) {
							for (let frame = 0; frame < xFramesConst; frame++) {
								const realIdx = baseOffset + 2 * srcCh * xBinsConst * xFramesConst + freq * xFramesConst + frame;
								const imagIdx = baseOffset + (2 * srcCh + 1) * xBinsConst * xFramesConst + freq * xFramesConst + frame;
								const destFrame = frame + 2;
								const realArr = freqRealBuffers[destFrame];
								const imagArr = freqImagBuffers[destFrame];

								if (realArr && imagArr) {
									realArr[freq] = xOut.data[realIdx] ?? 0;
									imagArr[freq] = xOut.data[imagIdx] ?? 0;
								}
							}
						}
					}

					const freqWaveform = computeIstftScaled(freqRealBuffers, freqImagBuffers, stftLenConst);

					const freqOffset = stftPadConst + pad;

					for (let index = 0; index < chunkLength; index++) {
						const timeVal = xtOut ? (xtOut.data[xtIndex + index] ?? 0) : 0;
						const freqVal = freqWaveform[freqOffset + index] ?? 0;
						const combined = timeVal + freqVal;
						const wt = weight[index] ?? 1;

						const outIdx = source * 2 + ch;
						const arr = stemOutputs[outIdx];

						if (arr) {
							arr[segmentOffset + index] = (arr[segmentOffset + index] ?? 0) + combined * wt;
						}
					}
				}
			}

			for (let index = 0; index < chunkLength; index++) {
				sumWeight[segmentOffset + index] = (sumWeight[segmentOffset + index] ?? 0) + (weight[index] ?? 0);
			}
		}

		const { stems } = props;
		const stemGains = [stems.drums, stems.bass, stems.other, stems.vocals];
		const outputChannels: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const output = new Float32Array(frames);
			const srcCh = Math.min(ch, 1);

			for (let index = 0; index < frames; index++) {
				const sw = sumWeight[index] ?? 1;
				let normalizedSum = 0;

				for (let source = 0; source < 4; source++) {
					const gain = stemGains[source] ?? 1;

					if (gain === 0) continue;

					const arr = stemOutputs[source * 2 + srcCh];

					normalizedSum += (arr ? (arr[index] ?? 0) / sw : 0) * gain;
				}

				output[index] = normalizedSum * std + mean;
			}

			outputChannels.push(output);
		}

		applyBandpass(outputChannels, HTDEMUCS_SAMPLE_RATE, props.highPass, props.lowPass);

		if ((this.sampleRate ?? 44100) !== HTDEMUCS_SAMPLE_RATE) {
			const resampled = await resampleDirect(props.ffmpegPath, outputChannels, HTDEMUCS_SAMPLE_RATE, this.sampleRate ?? 44100);

			for (let ch = 0; ch < outputChannels.length; ch++) {
				const resampledCh = resampled[ch];

				if (!resampledCh) continue;

				const finalCh = new Float32Array(originalFrames);

				finalCh.set(resampledCh.subarray(0, Math.min(resampledCh.length, originalFrames)));
				outputChannels[ch] = finalCh;
			}
		}

		await buffer.write(0, outputChannels);
	}
}

export class MusicRebalanceNode extends TransformNode<MusicRebalanceProperties> {
	static override readonly moduleName = "Music Rebalance";
	static override readonly moduleDescription = "Rebalance stem volumes using HTDemucs source separation";
	static override readonly schema = schema;
	static override is(value: unknown): value is MusicRebalanceNode {
		return TransformNode.is(value) && value.type[2] === "music-rebalance";
	}

	override readonly type = ["buffered-audio-node", "transform", "music-rebalance"] as const;

	constructor(properties: MusicRebalanceProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): MusicRebalanceStream {
		return new MusicRebalanceStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<MusicRebalanceProperties>): MusicRebalanceNode {
		return new MusicRebalanceNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function musicRebalance(
	modelPath: string,
	stems: Partial<StemGains>,
	options?: {
		ffmpegPath?: string;
		onnxAddonPath?: string;
		id?: string;
	},
): MusicRebalanceNode {
	const parsed = schema.parse({
		modelPath,
		ffmpegPath: options?.ffmpegPath,
		onnxAddonPath: options?.onnxAddonPath,
	});

	return new MusicRebalanceNode({
		...parsed,
		stems: {
			vocals: stems.vocals ?? 1,
			drums: stems.drums ?? 1,
			bass: stems.bass ?? 1,
			other: stems.other ?? 1,
		},
		id: options?.id,
	});
}
