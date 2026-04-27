// Per-block LSAR adapter for Ruhland 2015 BMRI (§II.C).
//
// The BMRI pipeline runs per-block AR detection + LSAR interpolation on the
// residual time-domain stream. Each block is one STFT frame's worth of
// samples (L = 2048). Ruhland §II.C and Figs. 2–3 specify that the LSAR
// linear system is solved over a range that includes `p_int` samples of
// context on each side of the block, so block-edge flagged samples can still
// be interpolated without falling under `lsar.ts`'s `gapIndex >= order &&
// gapIndex + order < length` guard (that guard is correct for the whole-
// signal gap-set case and we do not modify it — see the 1.3 decision in
// `plan-declick-bmri-rewrite.md`).
//
// The adapter reads `arOrder` samples of context from `residualStream` on
// each side of the block, shifts local flagged indices by `arOrder` into the
// padded span, calls `lsarInterpolate` on the padded view, and writes the
// interpolated samples back into `residualStream`. Graceful-degradation at
// stream edges mirrors `lsarInterpolate`'s own guard: if the leading or
// trailing context is shorter than `arOrder` (first/last block), the
// out-of-range flagged samples are skipped with no modification, same as
// the in-place lsar.ts behaviour.

import { lsarInterpolate } from "./lsar";

/**
 * Interpolate the flagged samples of one block of `residualStream` in place
 * via per-block LSAR (Ruhland §II.C Eq. 13 / Figs. 2–3).
 *
 * - `residualStream`: the full time-domain residual signal.
 * - `blockStartIndex`: the offset of the block within `residualStream`.
 * - `blockLength`: the block length in samples (typically `fftSize = L`).
 * - `flaggedLocalIndices`: indices into the block (`0 ≤ idx < blockLength`)
 *   marked as impulsive by the AR-residual γ-rule.
 * - `coeffs`: AR coefficients from the detection stage's Burg fit. The
 *   detection-stage AR order is reused as the interpolation AR order per
 *   design-declick §Algorithm step 4 (both equal `p_det = p_int = 32`).
 *
 * Mutates `residualStream` in place at the flagged positions.
 */
export function bmriLsarInterpolateBlock(
	residualStream: Float32Array,
	blockStartIndex: number,
	blockLength: number,
	flaggedLocalIndices: ReadonlyArray<number>,
	coeffs: Float32Array,
): void {
	if (flaggedLocalIndices.length === 0 || coeffs.length === 0) return;

	const arOrder = coeffs.length;
	const streamLength = residualStream.length;
	const blockEndIndex = blockStartIndex + blockLength;

	if (blockEndIndex > streamLength) {
		// Caller asked to interpolate past the end of the stream — clamp.
		// This should not happen in BMRI's hop-aligned pipeline but we guard
		// to match lsar.ts's graceful-degradation posture.
		return;
	}

	// Determine the padded span bounds. Each side gets up to `arOrder` samples
	// of context from the surrounding stream. Short context at a stream edge
	// is accepted — the lsar.ts guard will skip flagged samples whose AR
	// support falls outside the padded span.
	const leadingContext = Math.min(arOrder, blockStartIndex);
	const trailingContext = Math.min(arOrder, streamLength - blockEndIndex);
	const paddedStart = blockStartIndex - leadingContext;
	const paddedEnd = blockEndIndex + trailingContext;
	const paddedLength = paddedEnd - paddedStart;

	if (paddedLength <= 0) return;

	// Copy the padded view into a scratch Float32Array so lsarInterpolate's
	// in-place mutation touches only our copy. We'll write interpolated
	// samples back to `residualStream` at the flagged positions afterwards.
	const padded = new Float32Array(paddedLength);

	for (let i = 0; i < paddedLength; i++) {
		padded[i] = residualStream[paddedStart + i] ?? 0;
	}

	// Shift local indices into the padded span.
	const paddedGap: Array<number> = [];

	for (const localIdx of flaggedLocalIndices) {
		if (localIdx < 0 || localIdx >= blockLength) continue;

		paddedGap.push(localIdx + leadingContext);
	}

	if (paddedGap.length === 0) return;

	lsarInterpolate(padded, paddedGap, coeffs);

	// Write back the interpolated samples only at the originally-flagged
	// positions. lsar.ts skips samples that don't meet its `gapIndex >= order`
	// guard; those positions remain the original residual value, which is what
	// we copied in. Writing back still produces the correct state.
	for (const localIdx of flaggedLocalIndices) {
		if (localIdx < 0 || localIdx >= blockLength) continue;

		const streamIdx = blockStartIndex + localIdx;
		const paddedIdx = localIdx + leadingContext;

		residualStream[streamIdx] = padded[paddedIdx] ?? 0;
	}
}
