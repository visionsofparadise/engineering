import type { OnnxSession } from "../../../utils/onnx-runtime";

export const DFN3_SAMPLE_RATE = 48000;
export const DFN3_HOP_SIZE = 480;
export const DFN3_FFT_SIZE = 960;
export const DFN3_STATE_SIZE = 45304;

/**
 * Run the DeepFilterNet3 (48 kHz) ONNX model over a mono audio signal.
 *
 * Framing matches the reference Python implementation:
 * - Pad the tail with `(hop - len % hop) % hop` zeros so total length is a multiple of hop.
 * - Append an extra `fft_size` (960) zero tail before chunking.
 * - Chunk into fixed-size `hop_size` (480) frames.
 * - Feed each frame plus the carried `[45304]` state tensor and the scalar `atten_lim_db`.
 * - Concatenate outputs and trim `fft_size - hop_size = 480` leading samples to realign,
 *   then slice to the original length.
 *
 * STFT/iSTFT is internal to the ONNX graph — no JS overlap-add.
 *
 * @param signal Input audio at 48 kHz (mono Float32Array).
 * @param session ONNX session for `dfn3.onnx`.
 * @param attenLimDb Attenuation cap in dB (0 = no cap).
 * @param thresholdDb Post-mask time-domain gate. Output samples whose absolute
 *  amplitude is below this dB (dBFS, reference 1.0) are zeroed. -Infinity disables.
 * @returns Enhanced signal of the same length as the input.
 */
export function processDfnFrames(signal: Float32Array, session: OnnxSession, attenLimDb: number, thresholdDb: number): Float32Array {
	const originalLength = signal.length;
	const hopPadding = (DFN3_HOP_SIZE - (originalLength % DFN3_HOP_SIZE)) % DFN3_HOP_SIZE;
	const paddedLength = originalLength + hopPadding + DFN3_FFT_SIZE;
	const padded = new Float32Array(paddedLength);

	padded.set(signal);

	const numFrames = paddedLength / DFN3_HOP_SIZE;
	const concat = new Float32Array(paddedLength);

	let state = new Float32Array(DFN3_STATE_SIZE);
	const attenBuffer = new Float32Array([attenLimDb]);

	for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
		const offset = frameIndex * DFN3_HOP_SIZE;
		const inputFrame = padded.slice(offset, offset + DFN3_HOP_SIZE);

		const result = session.run({
			input_frame: { data: inputFrame, dims: [DFN3_HOP_SIZE] },
			states: { data: state, dims: [DFN3_STATE_SIZE] },
			atten_lim_db: { data: attenBuffer, dims: [1] },
		});

		const enhanced = result.enhanced_audio_frame;
		const newStates = result.new_states;

		if (enhanced) {
			const outFrame = enhanced.data;
			const copyLen = Math.min(outFrame.length, DFN3_HOP_SIZE);

			for (let index = 0; index < copyLen; index++) {
				concat[offset + index] = outFrame[index] ?? 0;
			}
		}

		if (newStates) {
			state = new Float32Array(newStates.data);
		}
	}

	// Trim leading fft_size - hop_size samples (the reference realignment) and clip to
	// original length.
	const trimStart = DFN3_FFT_SIZE - DFN3_HOP_SIZE;
	const output = new Float32Array(originalLength);

	for (let index = 0; index < originalLength; index++) {
		output[index] = concat[trimStart + index] ?? 0;
	}

	// Time-domain post-mask gate: zero samples with |amp| below the dB threshold.
	// threshold in dB (dBFS, reference = 1.0). -Infinity or very low values disable.
	if (Number.isFinite(thresholdDb) && thresholdDb > -Infinity) {
		const linearThreshold = Math.pow(10, thresholdDb / 20);

		for (let index = 0; index < originalLength; index++) {
			if (Math.abs(output[index] ?? 0) < linearThreshold) {
				output[index] = 0;
			}
		}
	}

	return output;
}
