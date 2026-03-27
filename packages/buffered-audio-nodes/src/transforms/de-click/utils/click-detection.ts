import { smoothEnvelope } from "buffered-audio-nodes-utils";

export function detectClickMask(signal: Float32Array, sampleRate: number, sensitivity: number, maxClickDuration: number): Uint8Array {
	const mask = new Uint8Array(signal.length);

	const hpCutoff = 4000;
	const rc = 1 / (2 * Math.PI * hpCutoff);
	const dt = 1 / sampleRate;
	const alpha = rc / (rc + dt);

	const highPassed = new Float32Array(signal.length);
	let prevSample = 0;
	let prevHP = 0;

	for (let index = 0; index < signal.length; index++) {
		const sample = signal[index] ?? 0;

		highPassed[index] = alpha * (prevHP + sample - prevSample);
		prevSample = sample;
		prevHP = highPassed[index] ?? 0;
	}

	const envSmooth = Math.round(sampleRate * 0.0005);
	const envelope = new Float32Array(signal.length);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = (highPassed[index] ?? 0) * (highPassed[index] ?? 0);
	}

	smoothEnvelope(envelope, envSmooth);

	for (let index = 0; index < signal.length; index++) {
		envelope[index] = Math.sqrt(envelope[index] ?? 0);
	}

	const median = approximateMedian(envelope);
	const threshold = median * (5 + 20 * (1 - sensitivity));

	for (let index = 0; index < signal.length; index++) {
		if ((envelope[index] ?? 0) > threshold) {
			mask[index] = 1;
		}
	}

	let regionStart = -1;

	for (let index = 0; index <= signal.length; index++) {
		const active = index < signal.length && (mask[index] ?? 0) > 0;

		if (active && regionStart === -1) {
			regionStart = index;
		} else if (!active && regionStart !== -1) {
			if (index - regionStart > maxClickDuration) {
				for (let clear = regionStart; clear < index; clear++) {
					mask[clear] = 0;
				}
			}

			regionStart = -1;
		}
	}

	return mask;
}

export function buildBlendEnvelope(mask: Uint8Array, length: number, fadeSamples: number): Float32Array {
	const envelope = new Float32Array(length);

	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) > 0) {
			envelope[index] = 1;
		}
	}

	for (let index = 0; index < length; index++) {
		if ((mask[index] ?? 0) === 0) continue;

		const start = index;
		let end = index;

		while (end < length && (mask[end] ?? 0) > 0) {
			end++;
		}

		for (let fade = 0; fade < fadeSamples; fade++) {
			const pos = start - fadeSamples + fade;

			if (pos >= 0 && (envelope[pos] ?? 0) < 1) {
				const fadeIn = (fade + 1) / (fadeSamples + 1);

				envelope[pos] = Math.max(envelope[pos] ?? 0, fadeIn);
			}
		}

		for (let fade = 0; fade < fadeSamples; fade++) {
			const pos = end + fade;

			if (pos < length && (envelope[pos] ?? 0) < 1) {
				const fadeOut = 1 - (fade + 1) / (fadeSamples + 1);

				envelope[pos] = Math.max(envelope[pos] ?? 0, fadeOut);
			}
		}

		index = end - 1;
	}

	return envelope;
}

export function approximateMedian(values: Float32Array): number {
	const len = values.length;

	if (len === 0) return 0;

	let min = values[0] ?? 0;
	let max = values[0] ?? 0;

	for (let si = 1; si < len; si++) {
		const sample = values[si] ?? 0;

		if (sample < min) min = sample;
		if (sample > max) max = sample;
	}

	if (min === max) return min;

	const numBins = 1024;
	const bins = new Uint32Array(numBins);
	const scale = (numBins - 1) / (max - min);

	for (let si = 0; si < len; si++) {
		const bin = Math.floor(((values[si] ?? 0) - min) * scale);

		bins[bin] = (bins[bin] ?? 0) + 1;
	}

	const target = len >>> 1;
	let count = 0;

	for (let bi = 0; bi < numBins; bi++) {
		count += bins[bi] ?? 0;

		if (count > target) {
			return min + (bi + 0.5) / scale;
		}
	}

	return max;
}
