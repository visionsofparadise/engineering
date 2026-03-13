import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const binariesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../binaries");

export const binaries = {
	ffmpeg: resolve(binariesDir, "ffmpeg.exe"),
	ffprobe: resolve(binariesDir, "ffprobe.exe"),
	onnxAddon: resolve(binariesDir, "onnx_addon.node"),
	vkfftAddon: resolve(binariesDir, "vkfft_addon.node"),
	fftwAddon: resolve(binariesDir, "fftw_addon.node"),
	model1: resolve(binariesDir, "model_1.onnx"),
	model2: resolve(binariesDir, "model_2.onnx"),
	kimVocal2: resolve(binariesDir, "Kim_Vocal_2.onnx"),
	htdemucs: resolve(binariesDir, "htdemucs.onnx"),
} as const;
