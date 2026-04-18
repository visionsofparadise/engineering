import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import type { BiquadCoefficients } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { bandCoefficients, makeFilterState, processSample, type BandFilterState } from "./utils/band-filter";

export const bandSchema = z.object({
	type: z.enum(["lowpass", "highpass", "bandpass", "peaking", "lowshelf", "highshelf", "notch", "allpass"])
		.default("peaking")
		.describe("Filter type"),
	frequency: z.number().min(20).max(20000).multipleOf(1).default(1000).describe("Frequency (Hz)"),
	quality: z.number().min(0.1).max(100).multipleOf(0.01).default(0.71).describe("Q / Bandwidth"),
	gain: z.number().min(-24).max(24).multipleOf(0.1).optional().describe("Gain (dB) — peaking and shelf only"),
	enabled: z.boolean().default(true).describe("Enabled"),
});

export type EqBand = z.infer<typeof bandSchema>;

export const schema = z.object({
	bands: z.array(bandSchema).default([]).describe("EQ bands"),
});

export interface EqProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Multiband biquad EQ.
 *
 * Filter state is maintained across chunks so the biquad history carries
 * over correctly between streaming audio blocks. A new set of filter states
 * is created per stream instance (fresh per render).
 *
 * The band list is processed as a serial cascade: each band's output feeds
 * into the next band's input. Disabled bands pass audio unchanged.
 */
export class EqStream extends BufferedTransformStream<EqProperties> {
	/** Per-band, per-channel biquad state: filterStates[bandIndex][channelIndex] */
	private filterStates: Array<Array<BandFilterState>> = [];
	/** Cached coefficients per band, rebuilt when sampleRate is first known. */
	private coefficients: Array<BiquadCoefficients | null> = [];
	private sampleRateKnown = false;

	private ensureState(bands: Array<EqBand>, channels: number, sr: number): void {
		if (this.sampleRateKnown && this.filterStates.length === bands.length) return;

		this.sampleRateKnown = true;
		this.filterStates = bands.map(() =>
			Array.from({ length: channels }, () => makeFilterState()),
		);
		this.coefficients = bands.map((band) => (band.enabled ? bandCoefficients(band, sr) : null));
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { bands } = this.properties;

		if (bands.length === 0) return chunk;

		const channels = chunk.samples.length;
		const sr = chunk.sampleRate;

		this.ensureState(bands, channels, sr);

		// Build output samples per channel
		const outputSamples: Array<Float32Array> = chunk.samples.map((channel, ch) => {
			const frames = channel.length;
			const output = new Float32Array(frames);

			for (let index = 0; index < frames; index++) {
				let sample = channel[index] ?? 0;

				// Cascade through each band
				for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
					const band = bands[bandIndex];

					if (!band?.enabled) continue;

					const coeffs = this.coefficients[bandIndex];
					const state = this.filterStates[bandIndex]?.[ch];

					if (coeffs && state) {
						sample = processSample(sample, coeffs, state);
					}
				}

				output[index] = sample;
			}

			return output;
		});

		return { samples: outputSamples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class EqNode extends TransformNode<EqProperties> {
	static override readonly moduleName = "EQ";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Arbitrary multiband parametric equalizer";
	static override readonly schema = schema;
	static override is(value: unknown): value is EqNode {
		return TransformNode.is(value) && value.type[2] === "eq";
	}

	override readonly type = ["buffered-audio-node", "transform", "eq"] as const;

	override createStream(): EqStream {
		return new EqStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<EqProperties>): EqNode {
		return new EqNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function eq(options?: { bands?: Array<Partial<EqBand>>; id?: string }): EqNode {
	const parsed = schema.parse(options ?? {});

	return new EqNode({ ...parsed, id: options?.id });
}
