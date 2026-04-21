import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import type { BiquadCoefficients } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import {
	advanceEnvelope,
	computeReductionDb,
	dbToLinear,
	linearToDb,
	makeBiquadState,
	makeEnvelopeCoefficients,
	makeEnvelopeState,
	makeSidechainCoefficients,
	stepBiquad,
	type BiquadState,
	type EnvelopeCoefficients,
	type EnvelopeState,
} from "./utils/sidechain";

/**
 * Quality of the sidechain detection and split-band biquad.
 *
 * Q ≈ 2 gives roughly a 1/2-octave band centered at `frequency`, which is
 * the standard width for sibilance detection (RBJ bandpass at Q=2 has a
 * -3 dB bandwidth of ≈ 0.5 octaves). Not exposed as a user knob: it's a
 * well-established convention for de-essing and tying the sidechain filter
 * and the split-mode band-splitter to the same value keeps the split-mode
 * subtract/add identity exact.
 */
const SIDECHAIN_QUALITY = 2;

export const schema = z.object({
	frequency: z.number().min(1000).max(20000).multipleOf(1).default(6000).describe("Center frequency of the sibilance band (Hz)"),
	threshold: z.number().min(-80).max(0).multipleOf(0.1).default(-20).describe("Threshold (dBFS) — sidechain envelope level above which reduction kicks in"),
	ratio: z.number().min(1).max(20).multipleOf(0.1).default(4).describe("Ratio — downward expansion above threshold (1 = no reduction, 20 ≈ hard cap)"),
	range: z.number().min(-60).max(0).multipleOf(0.1).default(-12).describe("Range (dB) — maximum attenuation applied"),
	attack: z.number().min(0).max(100).multipleOf(0.1).default(5).describe("Attack (ms)"),
	release: z.number().min(0).max(1000).multipleOf(1).default(80).describe("Release (ms)"),
	mode: z.enum(["split", "wideband"]).default("split").describe("Split: attenuate sibilant band only. Wideband: attenuate full signal when sibilance detected."),
});

export interface DeEsserProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * De-esser — split-band sidechain compression for sibilance control.
 *
 * Signal flow per sample, per channel:
 * 1. Sidechain detect: bandpass the input around `frequency` (Q ≈ 2) to
 *    isolate the sibilant band, then run an attack/release-smoothed envelope
 *    follower on the rectified filter output.
 * 2. Gain reduction: convert envelope to dB, apply the ratio-expander formula
 *    `(envelope_db − threshold) × (1 − 1/ratio)` (negated for downward
 *    reduction), clamped to `range`. Returns 0 dB below threshold.
 * 3. Apply:
 *    - split mode:    output = input − band + band × 10^(gr_db/20)
 *                     where `band` is a *separate* bandpass pass (same
 *                     coefficients as the sidechain filter) with its own
 *                     running biquad state. Unity sum when gr = 0 dB.
 *    - wideband mode: output = input × 10^(gr_db/20)
 *
 * No lookahead — the detected reduction is applied to the same sample that
 * produced it. This trades a tiny amount of "punch-through" at the sibilance
 * onset for zero latency (important for live monitoring and for chains that
 * don't want to accumulate latency across nodes).
 *
 * State (biquad filter memory + envelope level) is per-channel and persists
 * across chunks. Streams are created fresh per render.
 */
export class DeEsserStream extends BufferedTransformStream<DeEsserProperties> {
	private sidechainStates: Array<BiquadState> = [];
	private bandSplitStates: Array<BiquadState> = [];
	private envelopeStates: Array<EnvelopeState> = [];
	private coefficients: BiquadCoefficients | null = null;
	private envelopeCoefficients: EnvelopeCoefficients | null = null;
	private sampleRateKnown = false;

	private ensureState(channels: number, sampleRate: number): void {
		if (this.sampleRateKnown && this.sidechainStates.length === channels) return;

		this.sampleRateKnown = true;

		const { frequency, attack, release } = this.properties;

		this.coefficients = makeSidechainCoefficients(sampleRate, frequency, SIDECHAIN_QUALITY);
		this.envelopeCoefficients = makeEnvelopeCoefficients(attack, release, sampleRate);
		this.sidechainStates = Array.from({ length: channels }, () => makeBiquadState());
		this.bandSplitStates = Array.from({ length: channels }, () => makeBiquadState());
		this.envelopeStates = Array.from({ length: channels }, () => makeEnvelopeState());
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { samples, sampleRate } = chunk;

		if (samples.length === 0) return chunk;

		const channels = samples.length;

		this.ensureState(channels, sampleRate);

		const coefficients = this.coefficients;
		const envelopeCoefficients = this.envelopeCoefficients;

		if (!coefficients || !envelopeCoefficients) return chunk;

		const frames = samples[0]?.length ?? 0;

		if (frames === 0) return chunk;

		const { threshold, ratio, range, mode } = this.properties;
		const outputSamples: Array<Float32Array> = samples.map((ch) => new Float32Array(ch.length));

		for (let ch = 0; ch < channels; ch++) {
			const sidechainState = this.sidechainStates[ch];
			const bandSplitState = this.bandSplitStates[ch];
			const envelopeState = this.envelopeStates[ch];
			const inCh = samples[ch];
			const outCh = outputSamples[ch];

			if (!sidechainState || !bandSplitState || !envelopeState || !inCh || !outCh) continue;

			for (let index = 0; index < frames; index++) {
				const sample = inCh[index] ?? 0;

				// 1. Sidechain: bandpass the input to isolate sibilance.
				const sidechainSample = stepBiquad(sample, coefficients, sidechainState);

				// 2. Envelope follower on rectified sidechain.
				const envelope = advanceEnvelope(sidechainSample, envelopeState, envelopeCoefficients);
				const envelopeDb = linearToDb(envelope);

				// 3. Ratio-expander gain reduction (dB, ≤ 0).
				const grDb = computeReductionDb(envelopeDb, threshold, ratio, range);
				const grLinear = dbToLinear(grDb);

				if (mode === "wideband") {
					outCh[index] = sample * grLinear;
				} else {
					// Split mode: subtract the bandpass band, add back the
					// attenuated band. When grLinear = 1 this is exactly
					// input − band + band = input (unity sum, bypass).
					//
					// The band-split filter is a separate biquad with its own
					// running state so that subtracting it from the unfiltered
					// input doesn't introduce the sidechain filter's phase
					// response into the bypass path. (If sidechain and band
					// shared state, their outputs would be identical and the
					// subtract/add identity would still hold — but keeping
					// them independent means phase-coherent band separation
					// for any Q and any future change to detector pre-shaping.)
					const band = stepBiquad(sample, coefficients, bandSplitState);

					outCh[index] = sample - band + band * grLinear;
				}
			}
		}

		return { samples: outputSamples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}

	override _teardown(): void {
		this.sidechainStates = [];
		this.bandSplitStates = [];
		this.envelopeStates = [];
		this.coefficients = null;
		this.envelopeCoefficients = null;
		this.sampleRateKnown = false;
	}
}

export class DeEsserNode extends TransformNode<DeEsserProperties> {
	static override readonly moduleName = "DeEsser";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "De-esser — split-band sidechain compression of sibilance";
	static override readonly schema = schema;
	static override is(value: unknown): value is DeEsserNode {
		return TransformNode.is(value) && value.type[2] === "de-esser";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-esser"] as const;

	override createStream(): DeEsserStream {
		return new DeEsserStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeEsserProperties>): DeEsserNode {
		return new DeEsserNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deEsser(options?: Partial<DeEsserProperties> & { id?: string }): DeEsserNode {
	const parsed = schema.parse(options ?? {});

	return new DeEsserNode({ ...parsed, id: options?.id });
}
