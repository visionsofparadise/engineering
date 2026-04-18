import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { linearToDb, dbToLinear } from "../dynamics/utils/gain";
import { makeEnvelopeCoefficients, type EnvelopeCoefficients } from "../dynamics/utils/envelope";

export const schema = z.object({
	threshold: z.number().min(-80).max(0).multipleOf(0.1).default(-40).describe("Threshold (dBFS)"),
	range: z.number().min(-80).max(0).multipleOf(1).default(-80).describe("Range (dB) — attenuation when gate is closed"),
	attack: z.number().min(0).max(500).multipleOf(0.1).default(1).describe("Attack (ms)"),
	hold: z.number().min(0).max(2000).multipleOf(1).default(100).describe("Hold (ms)"),
	release: z.number().min(0).max(5000).multipleOf(1).default(200).describe("Release (ms)"),
	hysteresis: z.number().min(0).max(24).multipleOf(0.1).default(6).describe("Hysteresis (dB) — separate open/close thresholds"),
});

export interface GateProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Per-channel gate state.
 */
interface GateChannelState {
	/** Current smoothed gain in linear scale (0–1). Starts at 1.0 (gate open). */
	currentGainLinear: number;
	/** Hold timer in samples. When > 0 the gate remains open. */
	holdSamplesRemaining: number;
	/** Whether the gate is currently open. */
	isOpen: boolean;
}

/**
 * Noise gate.
 *
 * Signal flow per sample:
 * 1. Compute absolute level of input sample.
 * 2. Determine open/close state using hysteresis:
 *    - Gate opens when level (dB) >= threshold
 *    - Gate closes when level (dB) < threshold - hysteresis
 * 3. When gate opens, reset hold timer.
 * 4. When signal drops below close threshold, decrement hold timer.
 *    Gate remains open while holdSamplesRemaining > 0.
 * 5. Target gain: 0dB (open) or range dB (closed).
 * 6. Smooth target gain via attack/release envelope follower.
 * 7. Apply smoothed gain to output sample.
 *
 * State is maintained across chunks (stream instance is fresh per render).
 */
export class GateStream extends BufferedTransformStream<GateProperties> {
	private channelStates: Array<GateChannelState> = [];
	private coefficients: EnvelopeCoefficients | null = null;
	private holdSamples = 0;
	private rangeLinear = 0;
	private openThresholdDb = 0;
	private closeThresholdDb = 0;
	private sampleRateKnown = false;

	private ensureState(channels: number, sampleRate: number): void {
		if (this.sampleRateKnown && this.channelStates.length === channels) return;

		this.sampleRateKnown = true;

		const { attack, release, hold, threshold, hysteresis, range } = this.properties;

		this.coefficients = makeEnvelopeCoefficients(attack, release, sampleRate);
		this.holdSamples = Math.max(0, Math.round((hold / 1000) * sampleRate));
		this.rangeLinear = dbToLinear(range);
		this.openThresholdDb = threshold;
		this.closeThresholdDb = threshold - hysteresis;

		// Initialize states: gate starts open (currentGainLinear=1) to avoid a click at the start of audio
		this.channelStates = Array.from({ length: channels }, () => ({
			currentGainLinear: 1,
			holdSamplesRemaining: 0,
			isOpen: true,
		}));
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		const { samples, sampleRate } = chunk;

		if (samples.length === 0) return chunk;

		const channels = samples.length;

		this.ensureState(channels, sampleRate);

		const coefficients = this.coefficients;

		if (!coefficients) return chunk;

		const frames = samples[0]?.length ?? 0;

		if (frames === 0) return chunk;

		const outputSamples: Array<Float32Array> = samples.map((ch) => new Float32Array(ch));

		for (let ch = 0; ch < channels; ch++) {
			const chState = this.channelStates[ch];
			const inCh = samples[ch];
			const outCh = outputSamples[ch];

			if (!chState || !inCh || !outCh) continue;

			for (let index = 0; index < frames; index++) {
				const sample = inCh[index] ?? 0;
				const levelDb = linearToDb(Math.abs(sample));

				// Hysteresis: open on high threshold, close on low threshold
				if (levelDb >= this.openThresholdDb) {
					chState.isOpen = true;
					chState.holdSamplesRemaining = this.holdSamples;
				} else if (levelDb < this.closeThresholdDb) {
					if (chState.holdSamplesRemaining > 0) {
						chState.holdSamplesRemaining--;
						// Hold keeps gate open even if signal has dropped
					} else {
						chState.isOpen = false;
					}
				} else {
					// In the hysteresis band: maintain current state but decrement hold
					if (chState.isOpen && chState.holdSamplesRemaining > 0) {
						chState.holdSamplesRemaining--;
					}
				}

				// Target gain in linear
				const targetGain = chState.isOpen ? 1 : this.rangeLinear;

				// Smooth using an EMA directly in the linear domain.
				// Attack coefficient applies when the gate is opening (gain rising toward 1).
				// Release coefficient applies when the gate is closing (gain falling toward range).
				const coeff = targetGain > chState.currentGainLinear ? coefficients.attack : coefficients.release;
				const newGain = coeff * chState.currentGainLinear + (1 - coeff) * targetGain;

				chState.currentGainLinear = newGain;

				outCh[index] = sample * newGain;
			}
		}

		return { samples: outputSamples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

export class GateNode extends TransformNode<GateProperties> {
	static override readonly moduleName = "Gate";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Noise gate — attenuates signal below threshold";
	static override readonly schema = schema;
	static override is(value: unknown): value is GateNode {
		return TransformNode.is(value) && value.type[2] === "gate";
	}

	override readonly type = ["buffered-audio-node", "transform", "gate"] as const;

	override createStream(): GateStream {
		return new GateStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<GateProperties>): GateNode {
		return new GateNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function gate(options?: Partial<GateProperties> & { id?: string }): GateNode {
	const parsed = schema.parse(options ?? {});

	return new GateNode({ ...parsed, id: options?.id });
}
