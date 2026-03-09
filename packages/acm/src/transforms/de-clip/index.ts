import type { AudioChainModuleInput, AudioChunk, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export interface DeClipProperties extends TransformModuleProperties {
	readonly threshold?: number;
	readonly method: "ar" | "sparse";
}

/**
 * Detects clipped samples and reconstructs the original waveform using
 * iterative AR interpolation.
 *
 * @see Janssen, A.J.E.M., Veldhuis, R.N.J., Vries, L.B. (1986). "Adaptive interpolation of
 *   discrete-time signals that can be modeled as autoregressive processes."
 *   IEEE TASSP, 34(2), 317-330. https://doi.org/10.1109/TASSP.1986.1164824
 * @see Zaviska, P., Rajmic, P., Ozerov, A., Rencker, L. (2021). "A Survey and an Extensive
 *   Evaluation of Popular Audio Declipping Methods."
 *   IEEE JSTSP, 15(1), 5-24. https://doi.org/10.1109/JSTSP.2020.3042071
 */
export class DeClipModule extends TransformModule {
	static override is(value: unknown): value is DeClipModule {
		return TransformModule.is(value) && value.type[2] === "de-clip";
	}

	readonly type = ["async-module", "transform", "de-clip"] as const;
	readonly properties: DeClipProperties;
	readonly latency = 0;

	private clipSampleRate = 44100;

	constructor(properties: AudioChainModuleInput<DeClipProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	get bufferSize(): number {
		return Math.round(this.clipSampleRate * 0.05);
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.clipSampleRate = context.sampleRate;
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const samples = chunk.samples.map((channel) => {
			const output = new Float32Array(channel);
			const clipThreshold = this.properties.threshold ?? detectClipThreshold(channel);

			const regions = detectClippedRegions(channel, clipThreshold);

			for (const region of regions) {
				reconstructClippedRegion(output, region.start, region.end, clipThreshold);
			}

			return output;
		});

		return { samples, offset: chunk.offset, duration: chunk.duration };
	}

	clone(overrides?: Partial<DeClipProperties>): DeClipModule {
		return new DeClipModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

interface ClipRegion {
	start: number;
	end: number;
}

function detectClipThreshold(signal: Float32Array): number {
	let peak = 0;

	for (const sample of signal) {
		const abs = Math.abs(sample);

		if (abs > peak) peak = abs;
	}

	return peak * 0.99;
}

function detectClippedRegions(signal: Float32Array, threshold: number): Array<ClipRegion> {
	const regions: Array<ClipRegion> = [];
	let regionStart = -1;

	for (let index = 0; index < signal.length; index++) {
		const isClipped = Math.abs(signal[index] ?? 0) >= threshold;

		if (isClipped && regionStart === -1) {
			regionStart = index;
		} else if (!isClipped && regionStart !== -1) {
			regions.push({ start: regionStart, end: index });
			regionStart = -1;
		}
	}

	if (regionStart !== -1) {
		regions.push({ start: regionStart, end: signal.length });
	}

	return regions;
}

function reconstructClippedRegion(signal: Float32Array, start: number, end: number, threshold: number): void {
	const arOrder = 16;
	const contextBefore = Math.max(0, start - arOrder * 4);
	const contextAfter = Math.min(signal.length, end + arOrder * 4);

	const contextSignal = signal.slice(contextBefore, contextAfter);
	const arCoeffs = fitArModelForDeclip(contextSignal, arOrder);

	const iterations = 5;
	const localStart = start - contextBefore;
	const localEnd = end - contextBefore;

	for (let iter = 0; iter < iterations; iter++) {
		for (let index = localStart; index < localEnd; index++) {
			let predicted = 0;

			for (let coeff = 0; coeff < arOrder; coeff++) {
				const sampleIdx = index - 1 - coeff;

				if (sampleIdx >= 0) {
					predicted += (arCoeffs[coeff] ?? 0) * (contextSignal[sampleIdx] ?? 0);
				}
			}

			const sign = (contextSignal[index] ?? 0) >= 0 ? 1 : -1;
			const constrained = Math.abs(predicted) >= threshold ? predicted : sign * (threshold + Math.abs(predicted - sign * threshold) * 0.5);

			contextSignal[index] = constrained;
		}
	}

	for (let index = localStart; index < localEnd; index++) {
		signal[contextBefore + index] = contextSignal[index] ?? 0;
	}
}

function fitArModelForDeclip(signal: Float32Array, order: number): Float32Array {
	const autocorr = new Float32Array(order + 1);

	for (let lag = 0; lag <= order; lag++) {
		let sum = 0;

		for (let index = lag; index < signal.length; index++) {
			sum += (signal[index] ?? 0) * (signal[index - lag] ?? 0);
		}

		autocorr[lag] = sum / signal.length;
	}

	return levinsonDurbin(autocorr, order);
}

function levinsonDurbin(autocorr: Float32Array, order: number): Float32Array {
	const coeffs = new Float32Array(order);
	const prev = new Float32Array(order);

	const r0 = autocorr[0] ?? 1;

	if (r0 === 0) return coeffs;

	const firstCoeff = (autocorr[1] ?? 0) / r0;
	coeffs[0] = firstCoeff;
	let error = r0 * (1 - firstCoeff * firstCoeff);

	for (let step = 1; step < order; step++) {
		let lambda = 0;

		for (let index = 0; index < step; index++) {
			lambda += (coeffs[index] ?? 0) * (autocorr[step - index] ?? 0);
		}

		lambda = ((autocorr[step + 1] ?? 0) - lambda) / Math.max(error, 1e-10);

		prev.set(coeffs);

		for (let index = 0; index < step; index++) {
			coeffs[index] = (prev[index] ?? 0) - lambda * (prev[step - 1 - index] ?? 0);
		}

		coeffs[step] = lambda;
		error *= 1 - lambda * lambda;

		if (error <= 0) break;
	}

	return coeffs;
}

export function deClip(options?: { threshold?: number; method?: "ar" | "sparse"; id?: string }): DeClipModule {
	return new DeClipModule({
		threshold: options?.threshold,
		method: options?.method ?? "ar",
		id: options?.id,
	});
}
