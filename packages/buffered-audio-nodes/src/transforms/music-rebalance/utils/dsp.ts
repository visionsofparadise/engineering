import { istft, stft } from "@e9g/buffered-audio-nodes-utils";

const FFT_SIZE = 4096;
const HOP_SIZE = 1024;

export function reflectPad(signal: Float32Array, padLeft: number, padRight: number, totalLen: number): Float32Array {
	const result = new Float32Array(totalLen);

	result.set(signal, padLeft);

	for (let index = 0; index < padLeft; index++) {
		result[padLeft - 1 - index] = result[padLeft + index] ?? 0;
	}

	const signalEnd = padLeft + signal.length - 1;

	for (let index = 0; index < padRight; index++) {
		result[signalEnd + index + 1] = result[signalEnd - index] ?? 0;
	}

	return result;
}

export interface ComplexStft {
	real: Array<Float32Array>;
	imag: Array<Float32Array>;
}

export function computeStftScaled(signal: Float32Array): ComplexStft {
	const scale = 1 / Math.sqrt(FFT_SIZE);
	const result = stft(signal, FFT_SIZE, HOP_SIZE);

	for (const frame of result.real) {
		for (let index = 0; index < frame.length; index++) {
			frame[index] = (frame[index] ?? 0) * scale;
		}
	}

	for (const frame of result.imag) {
		for (let index = 0; index < frame.length; index++) {
			frame[index] = (frame[index] ?? 0) * scale;
		}
	}

	return result;
}

export function computeIstftScaled(real: Array<Float32Array>, imag: Array<Float32Array>, outputLength: number): Float32Array {
	const scale = Math.sqrt(FFT_SIZE);

	for (const frame of real) {
		for (let index = 0; index < frame.length; index++) {
			frame[index] = (frame[index] ?? 0) * scale;
		}
	}

	for (const frame of imag) {
		for (let index = 0; index < frame.length; index++) {
			frame[index] = (frame[index] ?? 0) * scale;
		}
	}

	return istft({ real, imag, frames: real.length, fftSize: FFT_SIZE }, HOP_SIZE, outputLength);
}
