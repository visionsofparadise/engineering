import { TruePeakUpsampler, type TruePeakUpsamplingFactor } from "./true-peak-upsampler";

const DEFAULT_OVERSAMPLE_FACTOR: TruePeakUpsamplingFactor = 4;

/**
 * Streaming BS.1770-4 Annex 1 true-peak accumulator.
 *
 * Per-channel polyphase upsamples the signal via the spec-compliant
 * {@link TruePeakUpsampler} (BS.1770-4 Annex 1, 48-tap polyphase FIR
 * for 4× upsampling) and tracks the maximum |x| across all upsampled
 * samples and all channels. The result is a single linear amplitude —
 * the true peak of the signal, including intersample peaks that the
 * original sample grid hides.
 *
 * Consumes the signal in arbitrarily-sized chunks; the per-channel
 * upsampler's 12-tap history carries across {@link push} calls so
 * chunk boundaries are invisible to the result.
 *
 * Construct one accumulator per measurement, push successive chunks
 * via {@link push}, then call {@link finalize} to obtain the true peak.
 * {@link finalize} is idempotent — additional calls return the same
 * value. Returns 0 when no samples have been pushed.
 *
 * The `sampleRate` constructor argument is retained for API stability
 * (the prior IIR-based implementation needed it for biquad coefficient
 * design); the polyphase FIR is rate-independent so it is unused. The
 * argument may be dropped in a future revision once all call sites are
 * updated.
 */
export class TruePeakAccumulator {
	private readonly channelCount: number;
	private readonly upsamplers: ReadonlyArray<TruePeakUpsampler>;
	private runningMax = 0;

	constructor(_sampleRate: number, channelCount: number, oversampleFactor: TruePeakUpsamplingFactor = DEFAULT_OVERSAMPLE_FACTOR) {
		if (channelCount <= 0) {
			throw new Error(`TruePeakAccumulator: channelCount must be positive, got ${channelCount}`);
		}

		this.channelCount = channelCount;

		const upsamplers: Array<TruePeakUpsampler> = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			upsamplers.push(new TruePeakUpsampler(oversampleFactor));
		}

		this.upsamplers = upsamplers;
	}

	/**
	 * Consume `frames` of audio. `channels[c]` must have at least
	 * `frames` valid samples starting at index 0; oversized buffers are
	 * fine and avoid the need for caller-side slicing. The accumulator
	 * advances per-channel upsampler state exactly as if the samples
	 * were appended to a single contiguous buffer.
	 *
	 * The `frames` argument is accepted for symmetry with
	 * {@link IntegratedLufsAccumulator} even though
	 * {@link TruePeakUpsampler.upsample} derives length from the input
	 * slice.
	 */
	push(channels: ReadonlyArray<Float32Array>, frames: number): void {
		if (channels.length !== this.channelCount) {
			throw new Error(`TruePeakAccumulator: push got ${channels.length} channels, expected ${this.channelCount}`);
		}

		if (frames <= 0) return;

		for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex++) {
			const channel = channels[channelIndex];

			if (channel === undefined || channel.length < frames) {
				throw new Error(`TruePeakAccumulator: channel ${channelIndex} has ${channel?.length ?? 0} samples, fewer than the requested ${frames}`);
			}

			const upsampler = this.upsamplers[channelIndex];

			if (upsampler === undefined) {
				throw new Error(`TruePeakAccumulator: missing upsampler for channel ${channelIndex}`);
			}

			const slice = channel.length === frames ? channel : channel.subarray(0, frames);
			const upsampled = upsampler.upsample(slice);

			for (let index = 0; index < upsampled.length; index++) {
				const sample = upsampled[index] ?? 0;
				const magnitude = sample < 0 ? -sample : sample;

				if (magnitude > this.runningMax) this.runningMax = magnitude;
			}
		}
	}

	/**
	 * Return the linear amplitude max(|x|) across all upsampled samples
	 * and all channels. Idempotent — additional calls return the same
	 * value. Returns 0 when no samples have been pushed.
	 */
	finalize(): number {
		return this.runningMax;
	}
}
