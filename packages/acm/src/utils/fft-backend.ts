import { createRequire } from "node:module";
import type { ExecutionProvider } from "../module";

export type FftBackend = "vkfft" | "fftw" | "js";

interface FftAddon {
	batchFft(input: Float32Array, fftSize: number, batchCount: number): { re: Float32Array; im: Float32Array };
	batchIfft(re: Float32Array, im: Float32Array, fftSize: number, batchCount: number): Float32Array;
}

interface VkFftAddon extends FftAddon {
	detectDevice(): string | null;
}

const require = createRequire(import.meta.url);

function tryLoadVkfft(vkfftPath?: string): VkFftAddon | null {
	if (!vkfftPath) return null;
	try {
		return require(vkfftPath) as VkFftAddon;
	} catch {
		return null;
	}
}

function tryLoadFftw(fftwPath?: string): FftAddon | null {
	if (!fftwPath) return null;
	try {
		return require(fftwPath) as FftAddon;
	} catch {
		return null;
	}
}

export function detectFftBackend(executionProviders: ReadonlyArray<ExecutionProvider>, options?: { vkfftPath?: string; fftwPath?: string }): FftBackend {
	for (const provider of executionProviders) {
		if (provider === "gpu") {
			const vkfft = tryLoadVkfft(options?.vkfftPath);
			if (vkfft) {
				const device = vkfft.detectDevice();
				if (device) {
					return "vkfft";
				}
			}
		}
		if (provider === "cpu-native") {
			const fftw = tryLoadFftw(options?.fftwPath);
			if (fftw) {
				return "fftw";
			}
		}
		if (provider === "cpu") {
			return "js";
		}
	}

	return "js";
}

export function getFftAddon(backend: FftBackend, options?: { vkfftPath?: string; fftwPath?: string }): FftAddon | null {
	if (backend === "vkfft") return tryLoadVkfft(options?.vkfftPath);
	if (backend === "fftw") return tryLoadFftw(options?.fftwPath);
	return null;
}
