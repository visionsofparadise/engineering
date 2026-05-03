// BS.1770 uses 400 ms blocks at 100 ms step (75% overlap), so at any
// instant at most ceil(blockSize / blockStep) = 4 blocks are open. The
// general 3 s / 100 ms case (LRA short-term) also has at most 30 open
// blocks but we still only need a 4-slot ring while blockSize <= 4 *
// blockStep — for correctness across arbitrary block/step combinations
// the ring needs to be sized to ceil(blockSize / blockStep). We use that
// value as the runtime ring size.
const computeRingSize = (blockSize: number, blockStep: number): number => Math.max(1, Math.ceil(blockSize / blockStep));

/**
 * Streaming BS.1770-style overlapping block-sum accumulator.
 *
 * Consumes per-frame Float64 sums (typically the K-weighted squared
 * sums from {@link KWeightedSquaredSum}) and accumulates them into
 * fixed-size overlapping blocks at a fixed step. Returns the raw closed
 * block sums on {@link finalize} — no division by `blockSize`, no LUFS
 * conversion, no gating. Those are downstream consumer concerns.
 *
 * Block index `b` covers samples `[b * blockStep, b * blockStep + blockSize)`.
 * A block is "closed" once all `blockSize` of its samples have been
 * pushed; trailing partial blocks are dropped.
 *
 * No assumption that `blockSize` is a multiple of `blockStep`. The
 * close loop uses the general while-form so unusual ratios (or
 * blockSize == blockStep) are handled correctly.
 */
export class BlockSumAccumulator {
	private readonly blockSize: number;
	private readonly blockStep: number;
	private readonly ringSize: number;

	private readonly activeBlockSums: Float64Array;

	private readonly closedBlockSums: Array<number> = [];

	private samplesProcessed = 0;
	private nextBlockToOpen = 0;
	private nextBlockToClose = 0;
	private finalized = false;

	constructor(blockSize: number, blockStep: number) {
		if (blockSize <= 0) {
			throw new Error(`BlockSumAccumulator: blockSize must be positive, got ${blockSize}`);
		}

		if (blockStep <= 0) {
			throw new Error(`BlockSumAccumulator: blockStep must be positive, got ${blockStep}`);
		}

		this.blockSize = blockSize;
		this.blockStep = blockStep;
		this.ringSize = computeRingSize(blockSize, blockStep);
		this.activeBlockSums = new Float64Array(this.ringSize);
	}

	/**
	 * Consume `frames` per-frame sums starting at `perFrameSums[0]`.
	 * `perFrameSums.length` must be at least `frames`. Block boundary
	 * accounting advances exactly as if these values were appended to a
	 * single contiguous stream.
	 */
	push(perFrameSums: Float64Array, frames: number): void {
		if (this.finalized) {
			throw new Error("BlockSumAccumulator: push() called after finalize()");
		}

		if (frames <= 0) return;

		if (perFrameSums.length < frames) {
			throw new Error(`BlockSumAccumulator: perFrameSums has ${perFrameSums.length} entries, fewer than the requested ${frames}`);
		}

		const blockSize = this.blockSize;
		const blockStep = this.blockStep;
		const ringSize = this.ringSize;
		const activeBlockSums = this.activeBlockSums;

		for (let frameIndex = 0; frameIndex < frames; frameIndex++) {
			const globalSampleIndex = this.samplesProcessed;
			const sampleContribution = perFrameSums[frameIndex] ?? 0;

			// Open-block range for this sample matches the inline impl in
			// IntegratedLufsAccumulator:
			//   minBlock = max(0, ceil((s - blockSize + 1) / blockStep))
			//   maxBlock = floor(s / blockStep)
			const rawMinBlock = Math.ceil((globalSampleIndex - blockSize + 1) / blockStep);
			const minBlock = rawMinBlock < 0 ? 0 : rawMinBlock;
			const maxBlock = Math.floor(globalSampleIndex / blockStep);

			// Zero each newly-opened block's ring slot exactly once. The
			// slot may still hold stale data from block (maxBlock - ringSize)
			// closed earlier — closing does not zero the slot itself, only
			// the open-edge transition does.
			while (this.nextBlockToOpen <= maxBlock) {
				activeBlockSums[this.nextBlockToOpen % ringSize] = 0;
				this.nextBlockToOpen++;
			}

			for (let blockIndex = minBlock; blockIndex <= maxBlock; blockIndex++) {
				const slot = blockIndex % ringSize;

				activeBlockSums[slot] = (activeBlockSums[slot] ?? 0) + sampleContribution;
			}

			this.samplesProcessed = globalSampleIndex + 1;

			// Close any block whose final sample we have just processed.
			// General while-form — handles blockSize / blockStep ratios
			// where multiple blocks could close on the same sample (none
			// arise in BS.1770 400 ms / 100 ms, but the form is correct).
			while (this.samplesProcessed >= this.nextBlockToClose * blockStep + blockSize) {
				const closingIndex = this.nextBlockToClose;
				const slot = closingIndex % ringSize;

				this.closedBlockSums.push(activeBlockSums[slot] ?? 0);
				this.nextBlockToClose++;
			}
		}
	}

	/**
	 * Return the raw closed block sums in block-index order. Idempotent —
	 * additional calls return the same array. Subsequent {@link push}
	 * calls throw.
	 */
	finalize(): Array<number> {
		this.finalized = true;

		return this.closedBlockSums;
	}
}
