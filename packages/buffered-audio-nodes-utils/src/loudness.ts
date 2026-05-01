import { preFilterCoefficients, rlbFilterCoefficients } from "./biquad";

const LUFS_OFFSET = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_LU = -10;
const BLOCK_DURATION_SECONDS = 0.4;
const BLOCK_STEP_SECONDS = 0.1;

// BS.1770 uses 400 ms blocks at 100 ms step (75% overlap), so at any
// instant at most ceil(blockSize / blockStep) = 4 blocks are open.
const ACTIVE_BLOCK_RING_SIZE = 4;

/**
 * Streaming BS.1770-4 / EBU R128 integrated-loudness accumulator.
 *
 * K-weights each channel via cascaded pre-filter and RLB high-pass
 * biquads, accumulates mean-square per 400 ms block at 100 ms step (75%
 * overlap), and applies the two-stage gate from BS.1770-4: an absolute
 * -70 LUFS gate followed by a relative -10 LU gate referenced to the
 * absolute-gated mean.
 *
 * Consumes the signal in arbitrarily-sized chunks. Memory held while
 * running is bounded by the biquad state plus the closed-block sums
 * (~10 doubles per second of material — ~288 KB per hour).
 *
 * Channel weighting follows BS.1770-4 Table 4: caller supplies one
 * weight per channel (defaults to 1.0 each, correct for mono and
 * stereo). Surround weighting (Ls/Rs at 1.41) is the caller's
 * responsibility — pass appropriate weights if measuring 5.1.
 *
 * Construct one accumulator per measurement, push successive chunks via
 * {@link push}, then call {@link finalize} once to obtain integrated
 * LUFS. The accumulator is single-use; create a new instance per file.
 * Returns -Infinity if no blocks survive gating (silent / near-silent
 * signal) or if fewer than one 400 ms block was pushed.
 */
export class IntegratedLufsAccumulator {
	private readonly channelCount: number;
	private readonly blockSize: number;
	private readonly blockStep: number;

	private readonly preB0: number;
	private readonly preB1: number;
	private readonly preB2: number;
	private readonly preA1: number;
	private readonly preA2: number;
	private readonly rlbB0: number;
	private readonly rlbB1: number;
	private readonly rlbB2: number;
	private readonly rlbA1: number;
	private readonly rlbA2: number;

	// Per-channel K-weighting biquad state (pre-filter then RLB).
	private readonly preX1: Float64Array;
	private readonly preX2: Float64Array;
	private readonly preY1: Float64Array;
	private readonly preY2: Float64Array;
	private readonly rlbX1: Float64Array;
	private readonly rlbX2: Float64Array;
	private readonly rlbY1: Float64Array;
	private readonly rlbY2: Float64Array;

	private readonly weights: Float64Array;

	// Active-block ring. At most 4 blocks are open at any sample, so a
	// 4-slot ring keyed by `blockIndex % 4` suffices. Slots are zeroed
	// the moment a new block opens into them (handled in the inner loop
	// via the `minBlock > previousMinBlock` transition).
	private readonly activeBlockSums = new Float64Array(ACTIVE_BLOCK_RING_SIZE);

	// Sums of blocks that have completed (received all `blockSize`
	// samples). Used by the finalize-time gating math. Grows linearly in
	// signal duration; ~10 entries/sec of doubles.
	private readonly closedBlockSums: Array<number> = [];

	// Global running sample index. Equivalent to the `sampleIndex` loop
	// counter in the one-shot implementation.
	private samplesProcessed = 0;

	// The next block index whose `minBlock`-side opening edge we have
	// not yet crossed. Used to zero ring slots exactly once when a new
	// block opens into them. Starts at 0; advances each time
	// `minBlock` increments past it.
	private nextBlockToOpen = 0;

	// The next block index awaiting closure. Closes when
	// `samplesProcessed == nextBlockToClose * blockStep + blockSize`.
	private nextBlockToClose = 0;

	private finalized = false;

	constructor(sampleRate: number, channelCount: number, channelWeights?: ReadonlyArray<number>) {
		if (channelCount <= 0) {
			throw new Error(`IntegratedLufsAccumulator: channelCount must be positive, got ${channelCount}`);
		}

		const weights = channelWeights ?? new Array<number>(channelCount).fill(1);

		if (weights.length !== channelCount) {
			throw new Error(`IntegratedLufsAccumulator: channelWeights length ${weights.length} does not match channel count ${channelCount}`);
		}

		this.channelCount = channelCount;
		this.blockSize = Math.round(BLOCK_DURATION_SECONDS * sampleRate);
		this.blockStep = Math.round(BLOCK_STEP_SECONDS * sampleRate);

		const preFilter = preFilterCoefficients(sampleRate);
		const rlbFilter = rlbFilterCoefficients(sampleRate);

		this.preB0 = preFilter.fb[0];
		this.preB1 = preFilter.fb[1];
		this.preB2 = preFilter.fb[2];
		this.preA1 = preFilter.fa[1];
		this.preA2 = preFilter.fa[2];
		this.rlbB0 = rlbFilter.fb[0];
		this.rlbB1 = rlbFilter.fb[1];
		this.rlbB2 = rlbFilter.fb[2];
		this.rlbA1 = rlbFilter.fa[1];
		this.rlbA2 = rlbFilter.fa[2];

		this.preX1 = new Float64Array(channelCount);
		this.preX2 = new Float64Array(channelCount);
		this.preY1 = new Float64Array(channelCount);
		this.preY2 = new Float64Array(channelCount);
		this.rlbX1 = new Float64Array(channelCount);
		this.rlbX2 = new Float64Array(channelCount);
		this.rlbY1 = new Float64Array(channelCount);
		this.rlbY2 = new Float64Array(channelCount);

		this.weights = new Float64Array(channelCount);

		for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
			this.weights[channelIndex] = weights[channelIndex] ?? 1;
		}
	}

	/**
	 * Consume `frames` of audio. `channels[c]` must have at least
	 * `frames` valid samples starting at index 0; oversized buffers are
	 * fine and avoid the need for caller-side slicing. The accumulator
	 * advances biquad state and block accounting exactly as if these
	 * samples were appended to a single contiguous buffer.
	 */
	push(channels: ReadonlyArray<Float32Array>, frames: number): void {
		if (this.finalized) {
			throw new Error("IntegratedLufsAccumulator: push() called after finalize()");
		}

		if (channels.length !== this.channelCount) {
			throw new Error(`IntegratedLufsAccumulator: push got ${channels.length} channels, expected ${this.channelCount}`);
		}

		if (frames <= 0) return;

		for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex++) {
			const channel = channels[channelIndex] ?? new Float32Array(0);

			if (channel.length < frames) {
				throw new Error(`IntegratedLufsAccumulator: channel ${channelIndex} has ${channel.length} samples, fewer than the requested ${frames}`);
			}
		}

		const blockSize = this.blockSize;
		const blockStep = this.blockStep;
		const channelCount = this.channelCount;
		const weights = this.weights;
		const preB0 = this.preB0;
		const preB1 = this.preB1;
		const preB2 = this.preB2;
		const preA1 = this.preA1;
		const preA2 = this.preA2;
		const rlbB0 = this.rlbB0;
		const rlbB1 = this.rlbB1;
		const rlbB2 = this.rlbB2;
		const rlbA1 = this.rlbA1;
		const rlbA2 = this.rlbA2;
		const preX1 = this.preX1;
		const preX2 = this.preX2;
		const preY1 = this.preY1;
		const preY2 = this.preY2;
		const rlbX1 = this.rlbX1;
		const rlbX2 = this.rlbX2;
		const rlbY1 = this.rlbY1;
		const rlbY2 = this.rlbY2;
		const activeBlockSums = this.activeBlockSums;

		for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
			const globalSampleIndex = this.samplesProcessed;

			// Per-sample K-weighted, channel-weighted squared contribution.
			let sampleContribution = 0;

			for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
				const channel = channels[channelIndex] ?? channels[0] ?? new Float32Array(0);
				const x0 = channel[frameIndex] ?? 0;
				const px1 = preX1[channelIndex] ?? 0;
				const px2 = preX2[channelIndex] ?? 0;
				const py1 = preY1[channelIndex] ?? 0;
				const py2 = preY2[channelIndex] ?? 0;
				const preY = preB0 * x0 + preB1 * px1 + preB2 * px2 - preA1 * py1 - preA2 * py2;

				preX2[channelIndex] = px1;
				preX1[channelIndex] = x0;
				preY2[channelIndex] = py1;
				preY1[channelIndex] = preY;

				const rx1 = rlbX1[channelIndex] ?? 0;
				const rx2 = rlbX2[channelIndex] ?? 0;
				const ry1 = rlbY1[channelIndex] ?? 0;
				const ry2 = rlbY2[channelIndex] ?? 0;
				const rlbY = rlbB0 * preY + rlbB1 * rx1 + rlbB2 * rx2 - rlbA1 * ry1 - rlbA2 * ry2;

				rlbX2[channelIndex] = rx1;
				rlbX1[channelIndex] = preY;
				rlbY2[channelIndex] = ry1;
				rlbY1[channelIndex] = rlbY;

				sampleContribution += (weights[channelIndex] ?? 1) * rlbY * rlbY;
			}

			// Open-block range for this sample matches the one-shot impl:
			//   minBlock = max(0, ceil((s - blockSize + 1) / blockStep))
			//   maxBlock = floor(s / blockStep)
			// In streaming there is no upper-bound clamp on `blockCount - 1`;
			// trailing partial blocks are handled at finalize() by virtue of
			// only completed blocks landing in `closedBlockSums`.
			const rawMinBlock = Math.ceil((globalSampleIndex - blockSize + 1) / blockStep);
			const minBlock = rawMinBlock < 0 ? 0 : rawMinBlock;
			const maxBlock = Math.floor(globalSampleIndex / blockStep);

			// A new block opens at this sample when `maxBlock` advances. Zero
			// its ring slot before accumulating into it. The slot may still
			// hold stale data from block (maxBlock - ACTIVE_BLOCK_RING_SIZE)
			// closed earlier — closing does not zero the slot itself, only
			// the open-edge transition does.
			while (this.nextBlockToOpen <= maxBlock) {
				activeBlockSums[this.nextBlockToOpen % ACTIVE_BLOCK_RING_SIZE] = 0;
				this.nextBlockToOpen++;
			}

			for (let blockIndex = minBlock; blockIndex <= maxBlock; blockIndex++) {
				const slot = blockIndex % ACTIVE_BLOCK_RING_SIZE;

				activeBlockSums[slot] = (activeBlockSums[slot] ?? 0) + sampleContribution;
			}

			this.samplesProcessed = globalSampleIndex + 1;

			// Close any block whose final sample we have just processed. For
			// blockSize a multiple of blockStep (always: blockSize = 4 * blockStep
			// since 400 ms / 100 ms = 4) this closes at most one block per
			// sample, but the loop is correct in general.
			while (this.samplesProcessed >= this.nextBlockToClose * blockStep + blockSize) {
				const closingIndex = this.nextBlockToClose;
				const slot = closingIndex % ACTIVE_BLOCK_RING_SIZE;

				this.closedBlockSums.push(activeBlockSums[slot] ?? 0);
				this.nextBlockToClose++;
			}
		}
	}

	/**
	 * Apply the BS.1770 two-stage gating to all completed blocks and
	 * return integrated LUFS. Returns -Infinity if no blocks completed
	 * (signal shorter than one 400 ms block) or if every block fails the
	 * absolute or relative gate.
	 */
	finalize(): number {
		this.finalized = true;

		const closedBlockSums = this.closedBlockSums;
		const blockCount = closedBlockSums.length;

		if (blockCount === 0) return -Infinity;

		const blockSize = this.blockSize;

		// Stage 1: absolute gate at -70 LUFS. Compare powers directly to
		// avoid log10 in the gating loop.
		const absoluteThresholdPower = Math.pow(10, (ABSOLUTE_GATE_LUFS - LUFS_OFFSET) / 10);
		let absoluteSurvivorCount = 0;
		let absoluteSum = 0;

		for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
			const power = (closedBlockSums[blockIndex] ?? 0) / blockSize;

			if (power > absoluteThresholdPower) {
				absoluteSum += power;
				absoluteSurvivorCount++;
			}
		}

		if (absoluteSurvivorCount === 0) return -Infinity;

		// Stage 2: relative gate at -10 LU below absolute-gated mean LUFS.
		const absoluteMean = absoluteSum / absoluteSurvivorCount;
		const relativeThresholdLufs = LUFS_OFFSET + 10 * Math.log10(absoluteMean) + RELATIVE_GATE_OFFSET_LU;
		const relativeThresholdPower = Math.pow(10, (relativeThresholdLufs - LUFS_OFFSET) / 10);

		let relativeSurvivorCount = 0;
		let relativeSum = 0;

		for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
			const power = (closedBlockSums[blockIndex] ?? 0) / blockSize;

			if (power > absoluteThresholdPower && power > relativeThresholdPower) {
				relativeSum += power;
				relativeSurvivorCount++;
			}
		}

		if (relativeSurvivorCount === 0) return -Infinity;

		const integratedMean = relativeSum / relativeSurvivorCount;

		return LUFS_OFFSET + 10 * Math.log10(integratedMean);
	}
}

