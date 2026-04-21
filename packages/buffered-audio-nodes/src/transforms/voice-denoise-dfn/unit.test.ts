import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTransform } from "../../utils/test-pipeline";
import { notSilent, expectedDuration, somethingChanged, notAnomalous } from "../../utils/test-audio";
import { audio, binaries, hasBinaryFixtures, hasAudioFixtures } from "../../utils/test-binaries";
import { voiceDenoiseDfn } from ".";

const describeIfFixtureSet = hasBinaryFixtures("dfn3", "ffmpeg", "onnxAddon") && hasAudioFixtures("testVoice") ? describe : describe.skip;

// Minimal WAV (32-bit float PCM) writer — just enough for the test pipeline's read path.
function encodeWavFloat32(samples: Float32Array, sampleRate: number): Buffer {
	const numChannels = 1;
	const bitsPerSample = 32;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = samples.length * (bitsPerSample / 8);
	const buffer = Buffer.alloc(44 + dataSize);

	buffer.write("RIFF", 0, "ascii");
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8, "ascii");
	buffer.write("fmt ", 12, "ascii");
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(3, 20); // IEEE float
	buffer.writeUInt16LE(numChannels, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(byteRate, 28);
	buffer.writeUInt16LE(blockAlign, 32);
	buffer.writeUInt16LE(bitsPerSample, 34);
	buffer.write("data", 36, "ascii");
	buffer.writeUInt32LE(dataSize, 40);

	for (let index = 0; index < samples.length; index++) {
		buffer.writeFloatLE(samples[index] ?? 0, 44 + index * 4);
	}

	return buffer;
}

function computeRms(signal: Float32Array): number {
	let sum = 0;

	for (let index = 0; index < signal.length; index++) {
		const sample = signal[index] ?? 0;

		sum += sample * sample;
	}

	return Math.sqrt(sum / Math.max(signal.length, 1));
}

describeIfFixtureSet("voice-denoise-dfn", () => {
	it("processes voice audio", async () => {
		const transform = voiceDenoiseDfn({
			modelPath: binaries.dfn3,
			ffmpegPath: binaries.ffmpeg,
			onnxAddonPath: binaries.onnxAddon,
		});
		const { input, output, context } = await runTransform(audio.testVoice, transform);

		expect(notSilent(output).pass).toBe(true);
		expect(expectedDuration(output, context.durationFrames ?? 0).pass).toBe(true);
		expect(somethingChanged(input, output).pass).toBe(true);
		expect(notAnomalous(output).pass).toBe(true);
	}, 240_000);

	it("improves SNR on a noisy sine signal", async () => {
		// Synthetic test: 3-second 440 Hz sine + white noise at 48 kHz. After DFN3
		// the non-speech broadband noise should be suppressed substantially.
		// DFN3 is a speech-enhancement model, so a pure tone is a weak proxy for
		// speech — we only assert a modest noise-reduction floor, not a large one.
		const sampleRate = 48000;
		const durationSeconds = 3;
		const numSamples = sampleRate * durationSeconds;
		const signalAmp = 0.2;
		const noiseAmp = 0.1;
		const noisy = new Float32Array(numSamples);

		for (let index = 0; index < numSamples; index++) {
			const sine = signalAmp * Math.sin((2 * Math.PI * 440 * index) / sampleRate);
			const noise = noiseAmp * (Math.random() * 2 - 1);

			noisy[index] = sine + noise;
		}

		const tempPath = join(tmpdir(), `dfn-snr-${randomBytes(8).toString("hex")}.wav`);

		await writeFile(tempPath, encodeWavFloat32(noisy, sampleRate));

		try {
			const transform = voiceDenoiseDfn({
				modelPath: binaries.dfn3,
				ffmpegPath: binaries.ffmpeg,
				onnxAddonPath: binaries.onnxAddon,
			});
			const { input, output } = await runTransform(tempPath, transform);
			const inputRms = computeRms(input[0] ?? new Float32Array());
			const outputRms = computeRms(output[0] ?? new Float32Array());

			// Since the input signal is dominated by noise that DFN3 cannot map to
			// speech, we expect total energy to drop (noise removal). Floor: output
			// RMS must be at least 1 dB lower than input RMS (a soft floor — the
			// model is not tuned for pure tones).
			const reductionDb = 20 * Math.log10((inputRms + 1e-12) / (outputRms + 1e-12));

			expect(reductionDb).toBeGreaterThanOrEqual(1);
			expect(notAnomalous(output).pass).toBe(true);
		} finally {
			try {
				await unlink(tempPath);
			} catch {
				// best-effort cleanup
			}
		}
	}, 240_000);
});
