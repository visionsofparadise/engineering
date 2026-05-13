/**
 * Sliding-window minimum primitives.
 *
 * Mirror of {@link ./sliding-window-max} with the deque comparison
 * flipped: for each output index `outputIdx`, the value is `min over
 * m in [outputIdx - halfWidth, outputIdx + halfWidth] of input[m]`,
 * clamped to the array bounds `[0, length - 1]`. Window width is
 * `2 * halfWidth + 1` samples (centered on the output index).
 *
 * Used by the loudness-target node's exact-at-peak gain envelope (see
 * `design-loudness-target.md` §"Smoothing"): the per-sample linear gain
 * sequence is pushed through this stream so the IIR smoothing operates
 * on a min-held (i.e. maximally-attenuated) input. Min in linear gain
 * equals max attenuation — the heaviest gain over the window. Combined
 * with a per-sample clamp `min(g_iir, g_min_hold)`, this guarantees the
 * smoothed gain at any sample never exceeds the per-sample target gain
 * at the loudest neighbour within `halfWidth`, which is the brick-wall
 * exactness condition.
 *
 * Two exports:
 *   - {@link slidingWindowMin} — stateless whole-array form. The
 *     reference implementation lives here so the streaming variant has
 *     a single source-of-truth to be checked against.
 *   - {@link SlidingWindowMinStream} — chunk-streaming form. Caller
 *     pushes input chunks; helper emits matching output chunks deferred
 *     by `halfWidth` samples on the leading edge. State (deque of
 *     monotonically-increasing input indices) is held internally and
 *     persists across chunks. Total output length across all chunks
 *     equals total input length once `isFinal === true` is signalled
 *     to the final `push`.
 *
 * Algorithmic note: the deque stores absolute input indices so chunk
 * boundaries don't require re-indexing. Values at those indices are
 * strictly increasing from front to back; the front of the deque is
 * always the running window-min for the next output position. O(N)
 * total — each input index is pushed and popped at most once across
 * the whole stream.
 */

/**
 * Whole-array sliding-window min. For each `outputIdx ∈ [0, length)`,
 * returns `min over m in [outputIdx - halfWidth, outputIdx + halfWidth]
 * of input[m]` (clamped to the array bounds).
 *
 * Deque-based monotonic-queue O(N) algorithm; mirrors
 * {@link ./sliding-window-max.slidingWindowMax} with the comparison
 * flipped. Returns a fresh `Float32Array(input.length)`.
 */
export function slidingWindowMin(input: Float32Array, halfWidth: number): Float32Array {
	const length = input.length;
	const output = new Float32Array(length);

	if (length === 0) return output;

	const deque = new Int32Array(length);
	let dequeHead = 0;
	let dequeTail = 0;
	let nextRight = 0;

	for (let outputIdx = 0; outputIdx < length; outputIdx++) {
		const rightEdge = Math.min(length - 1, outputIdx + halfWidth);
		const leftEdge = Math.max(0, outputIdx - halfWidth);

		while (nextRight <= rightEdge) {
			const value = input[nextRight] ?? 0;

			// Flipped comparison vs max: pop the tail while back-of-deque
			// values are >= the new value, leaving a strictly-increasing
			// stack from head to tail (front = running min).
			while (dequeTail > dequeHead && (input[deque[dequeTail - 1] ?? 0] ?? 0) >= value) {
				dequeTail--;
			}

			deque[dequeTail] = nextRight;
			dequeTail++;
			nextRight++;
		}

		while (dequeTail > dequeHead && (deque[dequeHead] ?? 0) < leftEdge) {
			dequeHead++;
		}

		output[outputIdx] = input[deque[dequeHead] ?? 0] ?? 0;
	}

	return output;
}

/**
 * Chunk-streaming sliding-window min with caller-driven `push`. Output
 * for sample at absolute index `n` requires input through absolute
 * index `n + halfWidth`, so the helper defers emission by `halfWidth`
 * samples on the leading edge. The trailing edge is collapsed when the
 * caller signals `isFinal === true`.
 *
 * Mirror of {@link ./sliding-window-max.SlidingWindowMaxStream} with
 * the deque comparison flipped (strictly-increasing front-to-back
 * instead of strictly-decreasing). See that file for the deque-and-ring
 * sizing rationale — the spans are identical because the algorithm
 * shape is identical.
 */
export class SlidingWindowMinStream {
	private readonly halfWidth: number;
	private readonly lookAhead: Float32Array;
	private readonly deque: Int32Array;
	private dequeHead = 0;
	private dequeTail = 0;
	private consumedFrames = 0;
	private emittedFrames = 0;

	constructor(halfWidth: number) {
		if (halfWidth < 0 || !Number.isFinite(halfWidth)) {
			throw new RangeError(`SlidingWindowMinStream: halfWidth must be a non-negative finite number, got ${halfWidth}`);
		}

		this.halfWidth = halfWidth;
		const ringCapacity = 2 * halfWidth + 1;

		this.lookAhead = new Float32Array(ringCapacity);
		this.deque = new Int32Array(ringCapacity);
	}

	/**
	 * Ingest the next chunk of input. Returns the next chunk of output
	 * (deferred by `halfWidth` on the leading edge). When `isFinal` is
	 * `true`, the trailing-edge outputs are flushed with the right-edge
	 * clamped to the last ingested input index.
	 */
	push(chunk: Float32Array, isFinal: boolean): Float32Array {
		const chunkLength = chunk.length;
		const halfWidth = this.halfWidth;
		const ringSize = this.lookAhead.length;
		const dequeCapacity = this.deque.length;
		const totalAfter = this.consumedFrames + chunkLength;
		const targetEmittedAfter = isFinal ? totalAfter : Math.max(0, totalAfter - halfWidth);
		const emitCount = Math.max(0, targetEmittedAfter - this.emittedFrames);
		const output = new Float32Array(emitCount);
		let outputCursor = 0;

		for (let chunkIdx = 0; chunkIdx < chunkLength; chunkIdx++) {
			const inputIdx = this.consumedFrames;
			const value = chunk[chunkIdx] ?? 0;

			this.lookAhead[inputIdx % ringSize] = value;

			// Flipped comparison vs max: pop while back-of-deque value is
			// >= new value, leaving a strictly-increasing deque.
			while (this.dequeTail > this.dequeHead) {
				const tailIdx = this.deque[(this.dequeTail - 1) % dequeCapacity] ?? 0;
				const tailValue = this.lookAhead[tailIdx % ringSize] ?? 0;

				if (tailValue < value) break;

				this.dequeTail--;
			}

			this.deque[this.dequeTail % dequeCapacity] = inputIdx;
			this.dequeTail++;
			this.consumedFrames++;

			const outputIdx = inputIdx - halfWidth;

			if (outputIdx < 0) continue;

			const leftEdge = Math.max(0, outputIdx - halfWidth);

			while (this.dequeTail > this.dequeHead && (this.deque[this.dequeHead % dequeCapacity] ?? 0) < leftEdge) {
				this.dequeHead++;
			}

			const frontIdx = this.deque[this.dequeHead % dequeCapacity] ?? 0;

			output[outputCursor] = this.lookAhead[frontIdx % ringSize] ?? 0;
			outputCursor++;
			this.emittedFrames++;
		}

		if (isFinal) {
			const finalLength = this.consumedFrames;

			while (this.emittedFrames < finalLength) {
				const outputIdx = this.emittedFrames;
				const leftEdge = Math.max(0, outputIdx - halfWidth);

				while (this.dequeTail > this.dequeHead && (this.deque[this.dequeHead % dequeCapacity] ?? 0) < leftEdge) {
					this.dequeHead++;
				}

				if (this.dequeTail === this.dequeHead) {
					output[outputCursor] = 0;
				} else {
					const frontIdx = this.deque[this.dequeHead % dequeCapacity] ?? 0;

					output[outputCursor] = this.lookAhead[frontIdx % ringSize] ?? 0;
				}

				outputCursor++;
				this.emittedFrames++;
			}
		}

		return output;
	}
}
