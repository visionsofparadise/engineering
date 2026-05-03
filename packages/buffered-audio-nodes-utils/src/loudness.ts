import { BlockSumAccumulator } from "./block-sum";
import { KWeightedSquaredSum } from "./k-weighted-squared-sum";

const LUFS_OFFSET = -0.691;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET_LU = -10;
const BLOCK_DURATION_SECONDS = 0.4;
const BLOCK_STEP_SECONDS = 0.1;
const SHORT_TERM_BLOCK_DURATION_SECONDS = 3;
const POWER_FLOOR = 1e-10;
const LRA_ABSOLUTE_GATE_LUFS = -70;
const LRA_RELATIVE_GATE_OFFSET_LU = -20;
const LRA_LOW_PERCENTILE = 0.1;
const LRA_HIGH_PERCENTILE = 0.95;

/**
 * Apply the BS.1770-4 two-stage gating to a list of closed block sums and
 * return integrated LUFS (or -Infinity if no block survives gating).
 *
 * `closedBlockSums[i]` is the raw sum of K-weighted squared samples for
 * block `i` (NOT divided by `blockSize`). Stage 1 absolute-gates blocks
 * at -70 LUFS; stage 2 relative-gates surviving blocks at -10 LU below
 * the absolute-gated mean.
 *
 * internal: shared with LoudnessAccumulator (Phase 4)
 */
function applyBs1770Gating(closedBlockSums: ReadonlyArray<number>, blockSize: number): number {
	const blockCount = closedBlockSums.length;

	if (blockCount === 0) return -Infinity;

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

/**
 * Streaming BS.1770-4 / EBU R128 integrated-loudness accumulator.
 *
 * K-weights each channel via cascaded pre-filter and RLB high-pass
 * biquads, accumulates mean-square per 400 ms block at 100 ms step (75%
 * overlap), and applies the two-stage gate from BS.1770-4: an absolute
 * -70 LUFS gate followed by a relative -10 LU gate referenced to the
 * absolute-gated mean.
 *
 * Composes {@link KWeightedSquaredSum} (the K-weighted squared-sum
 * source-of-truth) with {@link BlockSumAccumulator} configured at
 * 400 ms / 100 ms; the public API and numerical behaviour are unchanged
 * from the prior inline implementation.
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
	private readonly blockSize: number;

	private readonly kw: KWeightedSquaredSum;
	private readonly blocks: BlockSumAccumulator;

	// Reused per-frame K-weighted squared-sum buffer; grows on demand
	// when a push asks for more frames than the previous high-water mark.
	private outputBuffer: Float64Array = new Float64Array(0);

	private finalized = false;

	constructor(sampleRate: number, channelCount: number, channelWeights?: ReadonlyArray<number>) {
		// Constructor-time validation lives inside KWeightedSquaredSum.
		// Re-throw with the IntegratedLufsAccumulator-prefixed messages so
		// existing callers/tests that match on the prefix continue to see
		// it.
		if (channelCount <= 0) {
			throw new Error(`IntegratedLufsAccumulator: channelCount must be positive, got ${channelCount}`);
		}

		if (channelWeights !== undefined && channelWeights.length !== channelCount) {
			throw new Error(`IntegratedLufsAccumulator: channelWeights length ${channelWeights.length} does not match channel count ${channelCount}`);
		}

		this.blockSize = Math.round(BLOCK_DURATION_SECONDS * sampleRate);

		const blockStep = Math.round(BLOCK_STEP_SECONDS * sampleRate);

		this.kw = new KWeightedSquaredSum(sampleRate, channelCount, channelWeights);
		this.blocks = new BlockSumAccumulator(this.blockSize, blockStep);
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

		if (frames <= 0) return;

		if (this.outputBuffer.length < frames) {
			this.outputBuffer = new Float64Array(frames);
		}

		this.kw.push(channels, frames, this.outputBuffer);
		this.blocks.push(this.outputBuffer, frames);
	}

	/**
	 * Apply the BS.1770 two-stage gating to all completed blocks and
	 * return integrated LUFS. Returns -Infinity if no blocks completed
	 * (signal shorter than one 400 ms block) or if every block fails the
	 * absolute or relative gate.
	 */
	finalize(): number {
		this.finalized = true;

		return applyBs1770Gating(this.blocks.finalize(), this.blockSize);
	}
}

/**
 * Compute Loudness Range (LRA) from a list of short-term LUFS values, per
 * EBU Tech 3342. Two-stage gate (absolute -70 LUFS, relative -20 LU below
 * the absolute-gated mean) followed by the 10th–95th percentile spread of
 * the surviving short-term values.
 *
 * Mirrors the prior post-hoc implementation in
 * `loudness-stats/utils/measurement.ts:computeLra` exactly, including the
 * `< 2` survivor short-circuits and the `Math.floor(0.1 * n)` /
 * `Math.min(Math.ceil(0.95 * n) - 1, n - 1)` percentile index forms.
 *
 * internal: helper for LoudnessAccumulator
 */
function computeLraFromShortTerm(shortTermLoudness: ReadonlyArray<number>): number {
	const absoluteGated: Array<number> = [];

	for (let index = 0; index < shortTermLoudness.length; index++) {
		const value = shortTermLoudness[index] ?? 0;

		if (value > LRA_ABSOLUTE_GATE_LUFS) {
			absoluteGated.push(value);
		}
	}

	if (absoluteGated.length < 2) return 0;

	let absoluteSum = 0;

	for (let index = 0; index < absoluteGated.length; index++) {
		absoluteSum += Math.pow(10, (absoluteGated[index] ?? 0) / 10);
	}

	const absoluteMean = absoluteSum / absoluteGated.length;
	const relativeThreshold = 10 * Math.log10(absoluteMean) + LRA_RELATIVE_GATE_OFFSET_LU;

	const relativeGated: Array<number> = [];

	for (let index = 0; index < absoluteGated.length; index++) {
		const value = absoluteGated[index] ?? 0;

		if (value > relativeThreshold) {
			relativeGated.push(value);
		}
	}

	if (relativeGated.length < 2) return 0;

	relativeGated.sort((lhs, rhs) => lhs - rhs);

	const lowIndex = Math.floor(relativeGated.length * LRA_LOW_PERCENTILE);
	const highIndex = Math.min(Math.ceil(relativeGated.length * LRA_HIGH_PERCENTILE) - 1, relativeGated.length - 1);

	return (relativeGated[highIndex] ?? 0) - (relativeGated[lowIndex] ?? 0);
}

/**
 * Aggregate result from {@link LoudnessAccumulator.finalize}.
 *
 * - `integrated`: BS.1770-4 integrated LUFS (two-stage gate, 400 ms / 100 ms).
 *   `-Infinity` if no block survives gating or the input is shorter than
 *   one 400 ms block.
 * - `momentary`: per-400-ms-block LUFS values at 100 ms step. Ungated.
 *   The empty array means no full 400 ms block was completed.
 * - `shortTerm`: per-3-s-block LUFS values at 100 ms step. Ungated.
 *   The empty array means no full 3 s block was completed.
 * - `range`: EBU Tech 3342 Loudness Range (LU). `0` when fewer than two
 *   short-term blocks survive the LRA two-stage gate.
 */
export interface LoudnessAccumulatorResult {
	integrated: number;
	momentary: Array<number>;
	shortTerm: Array<number>;
	range: number;
}

/**
 * Streaming single-pass loudness accumulator producing all four
 * BS.1770 / EBU R128 metrics from one K-weight pass over the input.
 *
 * Composes one {@link KWeightedSquaredSum} feeding two parallel
 * {@link BlockSumAccumulator}s — 400 ms / 100 ms (integrated + momentary)
 * and 3 s / 100 ms (short-term + range). Drop-in replacement for the
 * post-hoc whole-buffer measurement path; constant-memory regardless of
 * input length.
 *
 * Channel weighting follows BS.1770-4 Table 4 (defaults to 1.0 per
 * channel). Construct one accumulator per measurement, push successive
 * chunks via {@link push}, then call {@link finalize} once for the
 * aggregate result. The accumulator is single-use; create a new instance
 * per file. {@link finalize} is idempotent (subsequent calls return the
 * cached result reference).
 */
export class LoudnessAccumulator {
	private readonly blockSize400: number;
	private readonly blockSize3s: number;

	private readonly kw: KWeightedSquaredSum;
	private readonly blocks400: BlockSumAccumulator;
	private readonly blocks3s: BlockSumAccumulator;

	// Reused per-frame K-weighted squared-sum buffer; grows on demand
	// when a push asks for more frames than the previous high-water mark.
	private outputBuffer: Float64Array = new Float64Array(0);

	private finalized = false;
	private cachedResult: LoudnessAccumulatorResult | undefined;

	constructor(sampleRate: number, channelCount: number, channelWeights?: ReadonlyArray<number>) {
		// Mirror IntegratedLufsAccumulator: validate at the wrapper so
		// callers see consistent error prefixes.
		if (channelCount <= 0) {
			throw new Error(`LoudnessAccumulator: channelCount must be positive, got ${channelCount}`);
		}

		if (channelWeights !== undefined && channelWeights.length !== channelCount) {
			throw new Error(`LoudnessAccumulator: channelWeights length ${channelWeights.length} does not match channel count ${channelCount}`);
		}

		this.blockSize400 = Math.round(BLOCK_DURATION_SECONDS * sampleRate);
		this.blockSize3s = Math.round(SHORT_TERM_BLOCK_DURATION_SECONDS * sampleRate);

		const blockStep = Math.round(BLOCK_STEP_SECONDS * sampleRate);

		this.kw = new KWeightedSquaredSum(sampleRate, channelCount, channelWeights);
		this.blocks400 = new BlockSumAccumulator(this.blockSize400, blockStep);
		this.blocks3s = new BlockSumAccumulator(this.blockSize3s, blockStep);
	}

	/**
	 * Consume `frames` of audio, advancing the K-weighting state and both
	 * block-sum accumulators in lockstep. Identical chunk-boundary
	 * semantics to {@link IntegratedLufsAccumulator.push}.
	 */
	push(channels: ReadonlyArray<Float32Array>, frames: number): void {
		if (this.finalized) {
			throw new Error("LoudnessAccumulator: push() called after finalize()");
		}

		if (frames <= 0) return;

		if (this.outputBuffer.length < frames) {
			this.outputBuffer = new Float64Array(frames);
		}

		this.kw.push(channels, frames, this.outputBuffer);
		this.blocks400.push(this.outputBuffer, frames);
		this.blocks3s.push(this.outputBuffer, frames);
	}

	/**
	 * Finalize and return all four metrics. Idempotent — additional calls
	 * return the same cached result object reference. Subsequent
	 * {@link push} calls throw.
	 */
	finalize(): LoudnessAccumulatorResult {
		if (this.cachedResult !== undefined) return this.cachedResult;

		this.finalized = true;

		const closed400 = this.blocks400.finalize();
		const closed3s = this.blocks3s.finalize();

		const blockSize400 = this.blockSize400;
		const blockSize3s = this.blockSize3s;

		const momentary: Array<number> = new Array<number>(closed400.length);

		for (let index = 0; index < closed400.length; index++) {
			const sum = closed400[index] ?? 0;

			momentary[index] = LUFS_OFFSET + 10 * Math.log10(Math.max(sum / blockSize400, POWER_FLOOR));
		}

		const shortTerm: Array<number> = new Array<number>(closed3s.length);

		for (let index = 0; index < closed3s.length; index++) {
			const sum = closed3s[index] ?? 0;

			shortTerm[index] = LUFS_OFFSET + 10 * Math.log10(Math.max(sum / blockSize3s, POWER_FLOOR));
		}

		const integrated = applyBs1770Gating(closed400, blockSize400);
		const range = computeLraFromShortTerm(shortTerm);

		this.cachedResult = { integrated, momentary, shortTerm, range };

		return this.cachedResult;
	}
}
