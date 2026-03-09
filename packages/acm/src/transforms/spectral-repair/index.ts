import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";
import { istft, stft } from "../../utils/stft";

export interface SpectralRegion {
	readonly startTime: number;
	readonly endTime: number;
	readonly startFreq: number;
	readonly endFreq: number;
}

export interface SpectralRepairProperties extends TransformModuleProperties {
	readonly regions: Array<SpectralRegion>;
	readonly method: "ar" | "nmf";
}

/**
 * Reconstructs damaged or missing regions in the spectrogram using
 * time-frequency domain AR interpolation.
 *
 * @see Mokry, O., Balusik, P., Rajmic, P. (2024). "Janssen 2.0: Audio Inpainting in the
 *   Time-frequency Domain." arXiv:2409.06392. https://arxiv.org/abs/2409.06392
 */
export class SpectralRepairModule extends TransformModule {
	static override is(value: unknown): value is SpectralRepairModule {
		return TransformModule.is(value) && value.type[2] === "spectral-repair";
	}

	readonly type = ["async-module", "transform", "spectral-repair"] as const;
	readonly properties: SpectralRepairProperties;

	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private repairSampleRate = 44100;

	constructor(properties: AudioChainModuleInput<SpectralRepairProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.repairSampleRate = context.sampleRate;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const sampleRate = this.repairSampleRate;
		const channels = buffer.channels;
		const frames = buffer.frames;
		const fftSize = 2048;
		const hopSize = fftSize / 4;
		const halfSize = fftSize / 2 + 1;
		const numStftFrames = Math.floor((frames - fftSize) / hopSize) + 1;
		const stftOutput = numStftFrames > 0 ? {
			real: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
			imag: Array.from({ length: numStftFrames }, () => new Float32Array(halfSize)),
		} : undefined;

		for (let ch = 0; ch < channels; ch++) {
			const chunk = await buffer.read(0, frames);
			const channel = chunk.samples[ch];

			if (!channel) continue;

			const stftResult = stft(channel, fftSize, hopSize, stftOutput);
			const freqPerBin = sampleRate / fftSize;
			const timePerFrame = hopSize / sampleRate;

			for (const region of this.properties.regions) {
				const startFrame = Math.floor(region.startTime / timePerFrame);
				const endFrame = Math.ceil(region.endTime / timePerFrame);
				const startBin = Math.floor(region.startFreq / freqPerBin);
				const endBin = Math.ceil(region.endFreq / freqPerBin);

				interpolateTfRegion(stftResult.real, stftResult.imag, startFrame, endFrame, startBin, endBin);
			}

			const repaired = istft(stftResult, hopSize, frames);

			await buffer.write(0, ch === 0 ? [repaired, ...(channels > 1 ? [chunk.samples[1] ?? new Float32Array(frames)] : [])] : [chunk.samples[0] ?? new Float32Array(frames), repaired]);
		}
	}

	clone(overrides?: Partial<SpectralRepairProperties>): SpectralRepairModule {
		return new SpectralRepairModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function interpolateTfRegion(real: Array<Float32Array>, imag: Array<Float32Array>, startFrame: number, endFrame: number, startBin: number, endBin: number): void {
	const iterations = 5;
	const clampedStart = Math.max(0, startFrame);
	const clampedEnd = Math.min(real.length, endFrame);

	for (let iter = 0; iter < iterations; iter++) {
		for (let frame = clampedStart; frame < clampedEnd; frame++) {
			const realFrame = real[frame];
			const imagFrame = imag[frame];

			if (!realFrame || !imagFrame) continue;

			const halfSize = realFrame.length;
			const clampedStartBin = Math.max(0, startBin);
			const clampedEndBin = Math.min(halfSize, endBin);

			for (let bin = clampedStartBin; bin < clampedEndBin; bin++) {
				let realSum = 0;
				let imagSum = 0;
				let count = 0;

				const prevFrame = real[frame - 1];
				const nextFrame = real[frame + 1];
				const prevImag = imag[frame - 1];
				const nextImag = imag[frame + 1];

				if (prevFrame && prevImag) {
					realSum += prevFrame[bin] ?? 0;
					imagSum += prevImag[bin] ?? 0;
					count++;
				}

				if (nextFrame && nextImag) {
					realSum += nextFrame[bin] ?? 0;
					imagSum += nextImag[bin] ?? 0;
					count++;
				}

				if (bin > 0) {
					realSum += realFrame[bin - 1] ?? 0;
					imagSum += imagFrame[bin - 1] ?? 0;
					count++;
				}

				if (bin < halfSize - 1) {
					realSum += realFrame[bin + 1] ?? 0;
					imagSum += imagFrame[bin + 1] ?? 0;
					count++;
				}

				if (count > 0) {
					realFrame[bin] = realSum / count;
					imagFrame[bin] = imagSum / count;
				}
			}
		}
	}
}

export function spectralRepair(
	regions: Array<SpectralRegion>,
	options?: {
		method?: "ar" | "nmf";
		id?: string;
	},
): SpectralRepairModule {
	return new SpectralRepairModule({
		regions,
		method: options?.method ?? "ar",
		id: options?.id,
	});
}
