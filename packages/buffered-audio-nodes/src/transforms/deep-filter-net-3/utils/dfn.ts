import type { OnnxSession } from "../../../utils/onnx-runtime";

export const DFN3_SAMPLE_RATE = 48000;
export const DFN3_HOP_SIZE = 480;
export const DFN3_FFT_SIZE = 960;
export const DFN3_STATE_SIZE = 45304;

/**
 * Carried per-stream inference state for DeepFilterNet3. The recurrent ONNX state
 * tensor and a 1-element atten buffer; both reused across `processDfnBlock` calls
 * to avoid per-frame allocation. The state is mutated in place via `state.set()`
 * after each ONNX call.
 */
export interface DfnState {
	state: Float32Array;
	atten: Float32Array;
}

/**
 * Allocate a fresh DFN3 state. Called once per channel per stream lifetime in
 * `DeepFilterNet3Stream._setup`.
 */
export function createDfnState(): DfnState {
	return {
		state: new Float32Array(DFN3_STATE_SIZE),
		atten: new Float32Array(1),
	};
}

/**
 * Run DeepFilterNet3 inference over a block of mono 48 kHz audio whose length is
 * a multiple of `DFN3_HOP_SIZE`. Mutates `dfnState.state` in place across hops so
 * the model's recurrent state carries across invocations of this function within
 * a stream lifetime.
 *
 * The trailing partial-block case (length not a hop multiple) only happens during
 * `handleFlush`'s single final call: the input is zero-padded internally up to the
 * next hop boundary, inference runs across the padded frames, and the returned
 * output is trimmed back to the actual input length. The recurrent state is
 * "dirty" after this trim but the stream is over.
 *
 * STFT/iSTFT is internal to the ONNX graph — no JS overlap-add. The
 * whole-file-only realignment trim and FFT-tail padding from the prior reference
 * implementation are gone: realignment is implicit in the model's recurrent state
 * across calls in streaming mode.
 *
 * @param dfnState The carried per-stream state. Mutated.
 * @param signal Input audio at 48 kHz (mono Float32Array).
 * @param session ONNX session for `dfn3.onnx`.
 * @param attenLimDb Attenuation cap in dB (0 = no cap).
 * @returns Enhanced signal of the same length as the input.
 */
export function processDfnBlock(dfnState: DfnState, signal: Float32Array, session: OnnxSession, attenLimDb: number): Float32Array {
	const originalLength = signal.length;
	const hopRemainder = originalLength % DFN3_HOP_SIZE;
	const paddedLength = hopRemainder === 0 ? originalLength : originalLength + (DFN3_HOP_SIZE - hopRemainder);
	const padded = paddedLength === originalLength ? signal : new Float32Array(paddedLength);

	if (padded !== signal) {
		padded.set(signal);
	}

	const numFrames = paddedLength / DFN3_HOP_SIZE;
	const output = new Float32Array(originalLength);
	const { state, atten } = dfnState;

	atten[0] = attenLimDb;

	for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
		const offset = frameIndex * DFN3_HOP_SIZE;
		const inputFrame = padded.subarray(offset, offset + DFN3_HOP_SIZE);

		const result = session.run({
			input_frame: { data: inputFrame, dims: [DFN3_HOP_SIZE] },
			states: { data: state, dims: [DFN3_STATE_SIZE] },
			atten_lim_db: { data: atten, dims: [1] },
		});

		const enhanced = result.enhanced_audio_frame;
		const newStates = result.new_states;

		if (enhanced) {
			const outFrame = enhanced.data;
			const writeStart = offset;
			// Trim against `originalLength` so the final partial block doesn't write
			// past the output buffer end (the padded zeros beyond originalLength are
			// inferred but not emitted).
			const writeEnd = Math.min(writeStart + DFN3_HOP_SIZE, originalLength);
			const copyLen = writeEnd - writeStart;

			for (let index = 0; index < copyLen; index++) {
				output[writeStart + index] = outFrame[index] ?? 0;
			}
		}

		if (newStates) {
			state.set(newStates.data);
		}
	}

	return output;
}

