import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { createOnnxSession, type OnnxSession } from "../../utils/onnx-runtime";
import { istft, stft } from "../../utils/stft";
import { applyTransform } from "../../utils/apply-transform";
import { resample } from "../resample";

export interface VoiceDenoiseProperties extends TransformModuleProperties {
	readonly modelPath1: string;
	readonly modelPath2: string;
}

const DTLN_SAMPLE_RATE = 16000;
const BLOCK_LEN = 512;
const BLOCK_SHIFT = 128;
const FFT_BINS = BLOCK_LEN / 2 + 1; // 257
const LSTM_UNITS = 128;

export class VoiceDenoiseModule extends TransformModule {
	static override is(value: unknown): value is VoiceDenoiseModule {
		return TransformModule.is(value) && value.type[2] === "voice-denoise";
	}

	readonly type = ["async-module", "transform", "voice-denoise"] as const;
	readonly properties: VoiceDenoiseProperties;

	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private session1?: OnnxSession;
	private session2?: OnnxSession;
	private sourceSampleRate = DTLN_SAMPLE_RATE;

	constructor(properties: AudioChainModuleInput<VoiceDenoiseProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	override async setup(context: StreamContext): Promise<void> {
		await super.setup(context);

		this.sourceSampleRate = context.sampleRate;
		this.session1 = await createOnnxSession(this.properties.modelPath1);
		this.session2 = await createOnnxSession(this.properties.modelPath2);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.session1 || !this.session2) {
			throw new Error("VoiceDenoiseTransformModule not set up — ONNX sessions not initialized");
		}

		const frames = buffer.frames;
		const channels = buffer.channels;

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			// Resample to 16kHz if needed
			let input16k: Float32Array = channel;

			if (this.sourceSampleRate !== DTLN_SAMPLE_RATE) {
				const resampled = await applyTransform(
					[channel],
					{ sampleRate: this.sourceSampleRate, channels: 1 },
					resample(DTLN_SAMPLE_RATE),
				);
				input16k = resampled[0] ?? channel;
			}

			const denoised16k = await this.processDtln(input16k);

			// Resample back to original sample rate if needed
			let output: Float32Array = denoised16k;

			if (this.sourceSampleRate !== DTLN_SAMPLE_RATE) {
				const resampled = await applyTransform(
					[denoised16k],
					{ sampleRate: DTLN_SAMPLE_RATE, channels: 1 },
					resample(this.sourceSampleRate),
				);
				output = resampled[0] ?? denoised16k;
			}

			// Ensure output matches input length
			const finalOutput = new Float32Array(frames);
			finalOutput.set(output.subarray(0, Math.min(output.length, frames)));

			const allChannels: Array<Float32Array> = [];

			for (let writeCh = 0; writeCh < channels; writeCh++) {
				allChannels.push(writeCh === ch ? finalOutput : (chunk.samples[writeCh] ?? new Float32Array(frames)));
			}

			await buffer.write(0, allChannels);
		}
	}

	private async processDtln(signal: Float32Array): Promise<Float32Array> {
		const session1 = this.session1;
		const session2 = this.session2;

		if (!session1 || !session2) {
			throw new Error("ONNX sessions not initialized");
		}

		const totalFrames = signal.length;
		const output = new Float32Array(totalFrames);

		// Initialize LSTM states for both models: [1, 2, 128, 2]
		const stateSize = 1 * 2 * LSTM_UNITS * 2;
		let states1 = new Float32Array(stateSize);
		let states2 = new Float32Array(stateSize);

		// Input buffer for overlap-add
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
		let outputOffset = 0;

		for (let offset = 0; offset + BLOCK_LEN <= totalFrames; offset += BLOCK_SHIFT) {
			// Extract block
			for (let index = 0; index < BLOCK_LEN; index++) {
				inputBuffer[index] = signal[offset + index] ?? 0;
			}

			// Step 1: Compute RFFT of the block
			const stftResult = stft(inputBuffer, BLOCK_LEN, BLOCK_LEN, stftOutput);
			const realFrame = stftResult.real[0];
			const imagFrame = stftResult.imag[0];

			if (!realFrame || !imagFrame) continue;

			// Compute log magnitude

			for (let bin = 0; bin < FFT_BINS; bin++) {
				const re = realFrame[bin] ?? 0;
				const im = imagFrame[bin] ?? 0;
				magnitude[bin] = Math.log(Math.sqrt(re * re + im * im) + 1e-7);
			}

			// Step 2: Run model 1 — magnitude mask estimation
			const result1 = await session1.run({
				input_2: { data: magnitude, dims: [1, 1, FFT_BINS] },
				input_3: { data: states1, dims: [1, 2, LSTM_UNITS, 2] },
			});

			const mask = result1.activation_2;
			states1 = result1.tf_op_layer_stack_2 ? new Float32Array(result1.tf_op_layer_stack_2.data) : states1;

			if (!mask) continue;

			// Step 3: Apply mask to STFT and compute iFFT
			for (let bin = 0; bin < FFT_BINS; bin++) {
				const maskVal = mask.data[bin] ?? 0;
				maskedReal[bin] = (realFrame[bin] ?? 0) * maskVal;
				maskedImag[bin] = (imagFrame[bin] ?? 0) * maskVal;
			}

			const maskedTimeDomain = istft(maskedStft, BLOCK_LEN, BLOCK_LEN);

			// Step 4: Run model 2 — time-domain processing
			const result2 = await session2.run({
				input_4: { data: maskedTimeDomain, dims: [1, 1, BLOCK_LEN] },
				input_5: { data: states2, dims: [1, 2, LSTM_UNITS, 2] },
			});

			const denoisedFrame = result2.conv1d_3;
			states2 = result2.tf_op_layer_stack_5 ? new Float32Array(result2.tf_op_layer_stack_5.data) : states2;

			if (!denoisedFrame) continue;

			// Step 5: Overlap-add output (only the shift portion)
			if (offset === 0) {
				// First block: write the full block
				for (let index = 0; index < BLOCK_LEN && index < totalFrames; index++) {
					output[index] = denoisedFrame.data[index] ?? 0;
				}
				outputOffset = BLOCK_LEN;
			} else {
				// Subsequent blocks: only add the new BLOCK_SHIFT samples
				const writeStart = offset + BLOCK_LEN - BLOCK_SHIFT;

				for (let index = 0; index < BLOCK_SHIFT; index++) {
					const outIdx = writeStart + index;

					if (outIdx < totalFrames) {
						output[outIdx] = denoisedFrame.data[BLOCK_LEN - BLOCK_SHIFT + index] ?? 0;
					}
				}

				outputOffset = Math.max(outputOffset, writeStart + BLOCK_SHIFT);
			}
		}

		return output;
	}

	protected override _teardown(): void {
		this.session1?.dispose();
		this.session1 = undefined;
		this.session2?.dispose();
		this.session2 = undefined;
	}

	clone(overrides?: Partial<VoiceDenoiseProperties>): VoiceDenoiseModule {
		return new VoiceDenoiseModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function voiceDenoise(
	modelDir: string,
	options?: {
		id?: string;
	},
): VoiceDenoiseModule {
	return new VoiceDenoiseModule({
		modelPath1: `${modelDir}/model_1.onnx`,
		modelPath2: `${modelDir}/model_2.onnx`,
		id: options?.id,
	});
}

