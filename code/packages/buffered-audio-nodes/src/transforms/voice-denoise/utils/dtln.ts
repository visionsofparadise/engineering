import type { FftBackend } from "../../../utils/fft-backend";
import type { OnnxSession } from "../../../utils/onnx-runtime";
import { istft, stft } from "../../../utils/stft";

const BLOCK_LEN = 512;
const BLOCK_SHIFT = 128;
const FFT_BINS = BLOCK_LEN / 2 + 1;
const LSTM_UNITS = 128;

export function processDtlnFrames(
	signal: Float32Array,
	session1: OnnxSession,
	session2: OnnxSession,
	fftBackend?: FftBackend,
	fftAddonOptions?: { vkfftPath?: string; fftwPath?: string },
): Float32Array {
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

		const stftResult = stft(inputBuffer, BLOCK_LEN, BLOCK_LEN, stftOutput, fftBackend, fftAddonOptions);
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

		const maskedTimeDomain = istft(maskedStft, BLOCK_LEN, BLOCK_LEN, fftBackend, fftAddonOptions);

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
