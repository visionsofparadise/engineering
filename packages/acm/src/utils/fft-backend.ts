import { createRequire } from "node:module";
import { ExecutionProvider } from "../module";

export type FftBackend = "vkfft" | "fftw" | "js";

interface FftAddon {
	batchFft(input: Float32Array, fftSize: number, batchCount: number): { re: Float32Array; im: Float32Array };
	batchIfft(re: Float32Array, im: Float32Array, fftSize: number, batchCount: number): Float32Array;
}

interface VkFftAddon extends FftAddon {
	detectDevice(): string | null;
}

const require = createRequire(import.meta.url);

let cachedBackend: FftBackend | undefined;
let cachedVkfft: VkFftAddon | null | undefined;
let cachedFftw: FftAddon | null | undefined;
let vkfftAddonPath: string | undefined;
let fftwAddonPath: string | undefined;

export function initFftBackend(options: { vkfftPath?: string; fftwPath?: string }): void {
	vkfftAddonPath = options.vkfftPath;
	fftwAddonPath = options.fftwPath;
	cachedBackend = undefined;
	cachedVkfft = undefined;
	cachedFftw = undefined;
}

function tryLoadVkfft(): VkFftAddon | null {
	if (cachedVkfft !== undefined) return cachedVkfft;
	if (!vkfftAddonPath) {
		cachedVkfft = null;
		return null;
	}
	try {
		cachedVkfft = require(vkfftAddonPath) as VkFftAddon;
	} catch {
		cachedVkfft = null;
	}
	return cachedVkfft;
}

function tryLoadFftw(): FftAddon | null {
	if (cachedFftw !== undefined) return cachedFftw;
	if (!fftwAddonPath) {
		cachedFftw = null;
		return null;
	}
	try {
		cachedFftw = require(fftwAddonPath) as FftAddon;
	} catch {
		cachedFftw = null;
	}
	return cachedFftw;
}

export function detectFftBackend(executionProviders: ReadonlyArray<ExecutionProvider>): FftBackend {
	if (cachedBackend !== undefined) return cachedBackend;

	for (const provider of executionProviders) {
		if (provider === "gpu") {
			const vkfft = tryLoadVkfft();
			if (vkfft) {
				const device = vkfft.detectDevice();
				if (device) {
					cachedBackend = "vkfft";
					return cachedBackend;
				}
			}
		}
		if (provider === "cpu-native") {
			const fftw = tryLoadFftw();
			if (fftw) {
				cachedBackend = "fftw";
				return cachedBackend;
			}
		}
		if (provider === "cpu") {
			cachedBackend = "js";
			return cachedBackend;
		}
	}

	cachedBackend = "js";
	return cachedBackend;
}

export function getFftAddon(backend: FftBackend): FftAddon | null {
	if (backend === "vkfft") return tryLoadVkfft();
	if (backend === "fftw") return tryLoadFftw();
	return null;
}
