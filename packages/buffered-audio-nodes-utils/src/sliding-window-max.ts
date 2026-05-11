/**
 * Sliding-window maximum primitives.
 *
 * For each output index `outputIdx`, the value is `max over m in
 * [outputIdx - halfWidth, outputIdx + halfWidth] of input[m]`, clamped
 * to the array bounds `[0, length - 1]`. Window width is `2 * halfWidth
 * + 1` samples (centered on the output index).
 *
 * Two exports:
 *   - {@link slidingWindowMax} — stateless whole-array form. The
 *     reference implementation lives here so the streaming variant has
 *     a single source-of-truth to be checked against.
 *   - {@link SlidingWindowMaxStream} — chunk-streaming form. Caller
 *     pushes input chunks; helper emits matching output chunks deferred
 *     by `halfWidth` samples on the leading edge. State (deque of
 *     monotonically-decreasing input indices) is held internally and
 *     persists across chunks. Total output length across all chunks
 *     equals total input length once `isFinal === true` is signalled
 *     to the final `push`.
 *
 * Algorithmic note: the deque stores absolute input indices so chunk
 * boundaries don't require re-indexing. Values at those indices are
 * strictly decreasing from front to back; the front of the deque is
 * always the running window-max for the next output position. O(N)
 * total — each input index is pushed and popped at most once across
 * the whole stream.
 *
 * Cross-node memory discipline (per design-transforms § "Memory
 * discipline"): the streaming form holds at most `2 * halfWidth + 1`
 * input indices in the deque + ring at any time, bounded by
 * `halfWidth` rather than total source length. Sizing covers the deque
 * span `[outputIdx - halfWidth, outputIdx + halfWidth]` for the most
 * recently emitted output.
 */

/**
 * Whole-array sliding-window max. For each `outputIdx ∈ [0, length)`,
 * returns `max over m in [outputIdx - halfWidth, outputIdx + halfWidth]
 * of input[m]` (clamped to the array bounds).
 *
 * Deque-based monotonic-queue O(N) algorithm; mirrors the form in the
 * Wikipedia article on "Sliding window minimum / maximum". Returns a
 * fresh `Float32Array(input.length)`.
 */
export function slidingWindowMax(input: Float32Array, halfWidth: number): Float32Array {
	const length = input.length;
	const output = new Float32Array(length);

	if (length === 0) return output;

	// Pre-sized circular buffer for deque indices. The deque can hold at
	// most `length` items at any moment; a sized typed array with
	// head/tail indices avoids the O(N) cost of `Array.shift()`.
	const deque = new Int32Array(length);
	let dequeHead = 0;
	let dequeTail = 0; // exclusive; deque is [dequeHead, dequeTail)
	let nextRight = 0;

	for (let outputIdx = 0; outputIdx < length; outputIdx++) {
		const rightEdge = Math.min(length - 1, outputIdx + halfWidth);
		const leftEdge = Math.max(0, outputIdx - halfWidth);

		// Extend the right edge of the window.
		while (nextRight <= rightEdge) {
			const value = input[nextRight] ?? 0;

			while (dequeTail > dequeHead && (input[deque[dequeTail - 1] ?? 0] ?? 0) <= value) {
				dequeTail--;
			}

			deque[dequeTail] = nextRight;
			dequeTail++;
			nextRight++;
		}

		// Drop indices that fell out of the left edge.
		while (dequeTail > dequeHead && (deque[dequeHead] ?? 0) < leftEdge) {
			dequeHead++;
		}

		output[outputIdx] = input[deque[dequeHead] ?? 0] ?? 0;
	}

	return output;
}

/**
 * Chunk-streaming sliding-window max with caller-driven `push`. Output
 * for sample at absolute index `n` requires input through absolute
 * index `n + halfWidth`, so the helper defers emission by `halfWidth`
 * samples on the leading edge. The trailing edge is collapsed when the
 * caller signals `isFinal === true` — at that point any remaining
 * output positions are emitted with the right edge clamped to the last
 * ingested input index.
 *
 * Internal state:
 *   - A deque of absolute input indices with monotonically-decreasing
 *     values from front to back. The front is always the running
 *     window-max for the next output position.
 *   - A trailing-input ring of size `2 * halfWidth + 1` so the deque
 *     can read input values by absolute index even after the value has
 *     moved out of the most recent chunk's local buffer. (Concretely:
 *     trailing-edge output positions need to read `input[deque[head]]`
 *     where `deque[head]` may be earlier than the start of the most
 *     recent chunk.) The `2 * halfWidth` span covers the leftmost
 *     active deque entry — which lies `halfWidth` behind the most
 *     recently emitted output, itself `halfWidth` behind the most
 *     recently ingested input.
 *   - `consumedFrames` — count of inputs ingested across all chunks;
 *     equals the next absolute input index.
 *   - `emittedFrames` — count of outputs produced across all chunks;
 *     equals the next absolute output index.
 *
 * Total output length across all chunks (after `isFinal === true`)
 * equals total input length and is byte-equivalent to
 * {@link slidingWindowMax} on the concatenated input.
 *
 * Identifier policy: `halfWidth`, `dequeHead`, `dequeTail`,
 * `lookAhead`, `consumedFrames`, `emittedFrames` (per the loudness
 * sub-system's naming-convention rule).
 */
export class SlidingWindowMaxStream {
	private readonly halfWidth: number;
	/**
	 * Ring buffer of the most recent `2 * halfWidth + 1` ingested input
	 * values, indexed by absolute input index modulo the ring size.
	 *
	 * Sizing rationale: the deque can hold input indices from `k - 2 *
	 * halfWidth` (the left edge of the most recent output's window) up
	 * to `k` (the most recently ingested input), so up to `2 *
	 * halfWidth + 1` distinct indices. The ring must be large enough
	 * that every deque entry's value is still readable, which forces
	 * the same span.
	 */
	private readonly lookAhead: Float32Array;
	/**
	 * Deque of absolute input indices. Values at those indices are
	 * strictly decreasing from `dequeHead` to `dequeTail - 1`. The
	 * front is the running window-max for the next output position.
	 *
	 * Capacity `2 * halfWidth + 1` per the same span argument as
	 * `lookAhead`: at any moment the deque holds indices within
	 * `[k - 2 * halfWidth, k]` where `k` is the most recently ingested
	 * input.
	 */
	private readonly deque: Int32Array;
	private dequeHead = 0;
	private dequeTail = 0;
	private consumedFrames = 0;
	private emittedFrames = 0;

	constructor(halfWidth: number) {
		if (halfWidth < 0 || !Number.isFinite(halfWidth)) {
			throw new RangeError(`SlidingWindowMaxStream: halfWidth must be a non-negative finite number, got ${halfWidth}`);
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
	 *
	 * The return value's length depends on the leading-edge fill state:
	 *   - Until total ingested ≥ `halfWidth + 1`, output length is 0
	 *     unless `isFinal` is true.
	 *   - Steady state: output length equals input chunk length.
	 *   - On the final chunk: output length equals input chunk length
	 *     plus any trailing-edge outputs not yet emitted (so total
	 *     across all calls equals total input length).
	 */
	push(chunk: Float32Array, isFinal: boolean): Float32Array {
		const chunkLength = chunk.length;
		const halfWidth = this.halfWidth;
		const ringSize = this.lookAhead.length;
		const dequeCapacity = this.deque.length;
		// Compute the maximum number of outputs this call can emit so we
		// can size the output buffer without reallocation:
		//   - Steady-state: each ingested input releases one output (the
		//     output `halfWidth` samples behind it).
		//   - On `isFinal`, all remaining unemitted outputs flush.
		const totalAfter = this.consumedFrames + chunkLength;
		// Without isFinal: outputs emitted so far + this call's
		// per-input emissions (one output per input once leading-edge
		// fill is past).
		const targetEmittedAfter = isFinal ? totalAfter : Math.max(0, totalAfter - halfWidth);
		const emitCount = Math.max(0, targetEmittedAfter - this.emittedFrames);
		const output = new Float32Array(emitCount);
		let outputCursor = 0;

		for (let chunkIdx = 0; chunkIdx < chunkLength; chunkIdx++) {
			const inputIdx = this.consumedFrames;
			const value = chunk[chunkIdx] ?? 0;

			// Push into the ring (indexed by absolute input index modulo
			// ring size). Older positions naturally overwrite — they are
			// no longer reachable from any output position still pending.
			this.lookAhead[inputIdx % ringSize] = value;

			// Maintain deque invariant: pop tail while back-of-deque
			// values are <= the new value. Reading via the ring is safe
			// because the deque only ever holds indices within the
			// active span (up to `2 * halfWidth` samples behind
			// `inputIdx`), and the ring holds the most recent
			// `2 * halfWidth + 1` values.
			while (this.dequeTail > this.dequeHead) {
				const tailIdx = this.deque[(this.dequeTail - 1) % dequeCapacity] ?? 0;
				const tailValue = this.lookAhead[tailIdx % ringSize] ?? 0;

				if (tailValue > value) break;

				this.dequeTail--;
			}

			this.deque[this.dequeTail % dequeCapacity] = inputIdx;
			this.dequeTail++;
			this.consumedFrames++;

			// Try to emit the output at index `inputIdx - halfWidth`. The
			// window for that output is `[outputIdx - halfWidth, outputIdx
			// + halfWidth]` = `[outputIdx - halfWidth, inputIdx]`, which
			// is fully ingested at this point (the right edge is the
			// just-pushed `inputIdx`).
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

		// Trailing-edge flush. After the final input has been ingested,
		// any output positions not yet emitted (those within the last
		// `halfWidth` of the source) get their right edge clamped to
		// `consumedFrames - 1`, so no new inputs are needed — only
		// further left-edge advances.
		if (isFinal) {
			const finalLength = this.consumedFrames;

			while (this.emittedFrames < finalLength) {
				const outputIdx = this.emittedFrames;
				const leftEdge = Math.max(0, outputIdx - halfWidth);

				while (this.dequeTail > this.dequeHead && (this.deque[this.dequeHead % dequeCapacity] ?? 0) < leftEdge) {
					this.dequeHead++;
				}

				if (this.dequeTail === this.dequeHead) {
					// Defensive: should be unreachable for non-empty inputs
					// because the deque always holds at least the most-
					// recent input index until that index falls out of the
					// left edge — and the loop's `outputIdx` cannot have
					// advanced beyond `consumedFrames - 1`.
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
