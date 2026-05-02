import { Oversampler, type OversamplingFactor } from "./oversample";

const DEFAULT_OVERSAMPLE_FACTOR: OversamplingFactor = 4;

/**
 * Streaming BS.1770-4 style true-peak accumulator.
 *
 * Per-channel polyphase upsamples the signal (default 4×, matching
 * BS.1770-4) through an anti-aliasing low-pass filter and tracks the
 * maximum |x| across all upsampled samples and all channels. The result
 * is a single linear amplitude — the true peak of the signal, including
 * intersample peaks that the original sample grid hides.
 *
 * Consumes the signal in arbitrarily-sized chunks; biquad state in the
 * per-channel {@link Oversampler} carries across {@link push} calls so
 * chunk boundaries are invisible to the result.
 *
 * Construct one accumulator per measurement, push successive chunks via
 * {@link push}, then call {@link finalize} to obtain the true peak.
 * {@link finalize} is idempotent — additional calls return the same
 * value. Returns 0 when no samples have been pushed.
 */
export class TruePeakAccumulator {
	private readonly channelCount: number;
	private readonly oversamplers: ReadonlyArray<Oversampler>;
	private runningMax = 0;

	constructor(sampleRate: number, channelCount: number, oversampleFactor: OversamplingFactor = DEFAULT_OVERSAMPLE_FACTOR) {
		if (channelCount <= 0) {
			throw new Error(`TruePeakAccumulator: channelCount must be positive, got ${channelCount}`);
		}

		this.channelCount = channelCount;

		const oversamplers: Array<Oversampler> = [];

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			oversamplers.push(new Oversampler(oversampleFactor, sampleRate));
		}

		this.oversamplers = oversamplers;
	}

	/**
	 * Consume `frames` of audio. `channels[c]` must have at least
	 * `frames` valid samples starting at index 0; oversized buffers are
	 * fine and avoid the need for caller-side slicing. The accumulator
	 * advances per-channel oversampler state exactly as if the samples
	 * were appended to a single contiguous buffer.
	 *
	 * The `frames` argument is accepted for symmetry with
	 * {@link IntegratedLufsAccumulator} even though the underlying
	 * {@link Oversampler.oversample} derives length from the input slice.
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

			const oversampler = this.oversamplers[channelIndex];

			if (oversampler === undefined) {
				throw new Error(`TruePeakAccumulator: missing oversampler for channel ${channelIndex}`);
			}

			const slice = channel.length === frames ? channel : channel.subarray(0, frames);

			oversampler.oversample(slice, (sample) => {
				const magnitude = sample < 0 ? -sample : sample;

				if (magnitude > this.runningMax) this.runningMax = magnitude;

				return sample;
			});
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
