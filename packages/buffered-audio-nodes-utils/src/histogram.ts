/**
 * Linear-amplitude histogram of |x| across a multi-channel buffer.
 *
 * Used by the loudnessCurve node's learn pass to derive the literal
 * anchors (max, median) for the source-specific transfer curve. Linear
 * (not log) buckets because the curve is parameterised in linear
 * amplitude space.
 *
 * Combined across channels: every sample from every channel contributes
 * to the same distribution. The curve is built once for the whole
 * stream regardless of channel count.
 */

export interface AmplitudeHistogram {
	/** Sample count per bucket. `buckets[i]` covers `[i * bucketMax / bucketCount, (i + 1) * bucketMax / bucketCount)`. */
	buckets: Uint32Array;
	/** Upper edge of the last bucket — the literal `max(|x|)` observed. */
	bucketMax: number;
	/** 50th-percentile amplitude of |x| across all samples (linear-interpolated within its bucket). */
	median: number;
}

/**
 * Compute the amplitude histogram of `|x|` across `channels`.
 *
 * `bucketCount` is the histogram resolution. `bucketMax` is taken from
 * the literal observed max of |x| (per the "literal anchors" rule in
 * design-loudness-curve).
 *
 * Edge cases:
 * - Empty input or all-zero input: `bucketMax = 0`, `median = 0`,
 *   `buckets` is an all-zero array.
 * - Single non-zero sample: `bucketMax = |sample|`, `median = |sample|`.
 *
 * Note: convention here is per-channel `Float32Array[]`, matching
 * `IntegratedLufsAccumulator.push` and `interleave` rather than the
 * single-buffer signature in the plan. The loudness-curve node's learn
 * pass operates on per-channel arrays, so this avoids a needless
 * interleave step at the call site.
 */
export function amplitudeHistogram(channels: ReadonlyArray<Float32Array>, bucketCount: number): AmplitudeHistogram {
	if (!Number.isInteger(bucketCount) || bucketCount <= 0) {
		throw new Error(`amplitudeHistogram: bucketCount must be a positive integer, got ${String(bucketCount)}`);
	}

	const buckets = new Uint32Array(bucketCount);
	let totalSamples = 0;
	let bucketMax = 0;

	// First pass: find max(|x|) and total sample count. We need the max
	// before bucketing so the upper edge is exact.
	for (const channel of channels) {
		const length = channel.length;

		totalSamples += length;

		for (let index = 0; index < length; index++) {
			const value = Math.abs(channel[index] ?? 0);

			if (value > bucketMax) bucketMax = value;
		}
	}

	if (totalSamples === 0 || bucketMax === 0) {
		return { buckets, bucketMax: 0, median: 0 };
	}

	// Second pass: bucket. The top edge maps to bucket `bucketCount - 1`
	// (not an out-of-range bucket); samples >= bucketMax land in the last
	// bucket by clamping.
	const scale = bucketCount / bucketMax;
	const lastBucket = bucketCount - 1;

	for (const channel of channels) {
		const length = channel.length;

		for (let index = 0; index < length; index++) {
			const value = Math.abs(channel[index] ?? 0);
			let bucketIndex = Math.floor(value * scale);

			if (bucketIndex < 0) bucketIndex = 0;
			else if (bucketIndex > lastBucket) bucketIndex = lastBucket;

			buckets[bucketIndex] = (buckets[bucketIndex] ?? 0) + 1;
		}
	}

	// Linear-interpolated median: walk the cumulative count until we
	// cross totalSamples / 2, then interpolate within that bucket.
	const target = totalSamples / 2;
	const bucketWidth = bucketMax / bucketCount;
	let cumulative = 0;
	let median = 0;

	for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex++) {
		const count = buckets[bucketIndex] ?? 0;
		const next = cumulative + count;

		if (next >= target) {
			// Fraction into this bucket where the cumulative count crosses
			// the target. Treats samples within a bucket as uniformly
			// distributed across the bucket's interval.
			const fraction = count > 0 ? (target - cumulative) / count : 0;

			median = (bucketIndex + fraction) * bucketWidth;
			break;
		}

		cumulative = next;
	}

	return { buckets, bucketMax, median };
}
