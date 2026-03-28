import { describe, it, expect } from "vitest";
import { stft, istft, type FftBackend } from "@e9g/buffered-audio-nodes-utils";
import { binaries } from "./test-binaries";

function maxError(a: Float32Array, b: Float32Array): number {
	let max = 0;
	for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
	return max;
}

function generateSignal(length: number): Float32Array {
	const signal = new Float32Array(length);
	for (let i = 0; i < length; i++) {
		signal[i] = Math.sin(2 * Math.PI * 440 * i / 48000)
			+ 0.5 * Math.sin(2 * Math.PI * 1000 * i / 48000)
			+ 0.3 * Math.sin(2 * Math.PI * 2500 * i / 48000);
	}
	return signal;
}

const backends: FftBackend[] = ["js", "fftw", "vkfft"];
const fftSize = 2048;
const hopSize = 512;
const signalLength = 48000; // 1 second at 48kHz
const fftAddonOptions = { vkfftPath: binaries.vkfftAddon, fftwPath: binaries.fftwAddon };

describe("FFT backend integration", () => {
	const signal = generateSignal(signalLength);

	for (const backend of backends) {
		describe(`backend: ${backend}`, () => {
			it("stft -> istft round-trip", { timeout: 30_000 }, () => {
				let result;
				try {
					result = stft(signal, fftSize, hopSize, undefined, backend, fftAddonOptions);
				} catch {
					// addon not available — skip
					console.log(`  [skip] ${backend} addon not loadable`);
					return;
				}

				expect(result.frames).toBeGreaterThan(0);
				expect(result.fftSize).toBe(fftSize);
				expect(result.real.length).toBe(result.frames);

				const reconstructed = istft(result, hopSize, signal.length, backend, fftAddonOptions);
				// trim edges where windowing causes artifacts
				const trim = fftSize;
				const sigTrimmed = signal.subarray(trim, signal.length - trim);
				const recTrimmed = reconstructed.subarray(trim, signal.length - trim);
				const err = maxError(sigTrimmed, recTrimmed);
				console.log(`  ${backend} round-trip error: ${err.toExponential(2)} (${result.frames} frames)`);
				expect(err).toBeLessThan(backend === "js" ? 1e-5 : 1e-3);
			});
		});
	}

	it("all available backends produce matching stft output", () => {
		const results: { backend: FftBackend; real: Array<Float32Array>; imag: Array<Float32Array> }[] = [];

		for (const backend of backends) {
			try {
				const result = stft(signal, fftSize, hopSize, undefined, backend, fftAddonOptions);
				results.push({ backend, real: result.real, imag: result.imag });
			} catch {
				// skip unavailable
			}
		}

		expect(results.length).toBeGreaterThanOrEqual(1);

		// compare all pairs
		for (let i = 1; i < results.length; i++) {
			const a = results[0]!;
			const b = results[i]!;
			let maxRe = 0, maxIm = 0;
			for (let f = 0; f < a.real.length; f++) {
				maxRe = Math.max(maxRe, maxError(a.real[f]!, b.real[f]!));
				maxIm = Math.max(maxIm, maxError(a.imag[f]!, b.imag[f]!));
			}
			console.log(`  ${a.backend} vs ${b.backend}: re=${maxRe.toExponential(2)}, im=${maxIm.toExponential(2)}`);
			expect(maxRe).toBeLessThan(1e-2);
			expect(maxIm).toBeLessThan(1e-2);
		}
	});
});

describe("FFT backend benchmark", () => {
	const signal = generateSignal(48000 * 10); // 10 seconds

	for (const backend of backends) {
		it(`benchmark: ${backend}`, () => {
			let loaded = true;
			try {
				stft(new Float32Array(fftSize), fftSize, hopSize, undefined, backend, fftAddonOptions);
			} catch {
				loaded = false;
			}
			if (!loaded) {
				console.log(`  [skip] ${backend} not available`);
				return;
			}

			// warmup
			stft(signal.subarray(0, 48000), fftSize, hopSize, undefined, backend, fftAddonOptions);

			const iterations = 3;
			const times: number[] = [];
			for (let i = 0; i < iterations; i++) {
				const start = performance.now();
				const result = stft(signal, fftSize, hopSize, undefined, backend, fftAddonOptions);
				const stftTime = performance.now() - start;

				const start2 = performance.now();
				istft(result, hopSize, signal.length, backend, fftAddonOptions);
				const istftTime = performance.now() - start2;

				times.push(stftTime + istftTime);
				console.log(`  ${backend} iter ${i + 1}: stft=${stftTime.toFixed(1)}ms, istft=${istftTime.toFixed(1)}ms, total=${(stftTime + istftTime).toFixed(1)}ms (${result.frames} frames)`);
			}

			const avg = times.reduce((s, t) => s + t, 0) / times.length;
			console.log(`  ${backend} avg: ${avg.toFixed(1)}ms`);
		}, 120_000);
	}
});
