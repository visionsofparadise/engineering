/**
 * Count samples that would be clipped by a true-peak limiter at the given
 * threshold (default -1 dBTP). Reports both sample-peak counts (literal
 * |x| > threshold) and true-peak counts (|x| > threshold after 4×
 * polyphase upsampling — what a real BS.1770-aware limiter would see).
 *
 * Usage: tsx qa-count-clips.ts <wav-path> [<wav-path> ...] [--threshold-db <dB>]
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Oversampler } from "@e9g/buffered-audio-nodes-utils";

const require = createRequire(import.meta.url);
const { WaveFile } = require("wavefile") as {
	WaveFile: new (data?: Uint8Array) => {
		fromScratch: (...args: Array<unknown>) => void;
		toBitDepth: (depth: string) => void;
		getSamples: (interleaved: boolean, ctor: typeof Float64Array) => Float64Array | Array<Float64Array>;
		fmt: { sampleRate: number; numChannels: number };
	};
};

interface Args {
	inputs: Array<string>;
	thresholdDb: number;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
	const args: Args = { inputs: [], thresholdDb: -1 };

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];

		if (flag === "--threshold-db") {
			args.thresholdDb = Number.parseFloat(argv[index + 1] ?? "-1");
			index++;
		} else if (!flag.startsWith("--")) {
			args.inputs.push(flag);
		}
	}

	if (args.inputs.length === 0) {
		process.stderr.write("Usage: tsx qa-count-clips.ts <wav-path> [<wav-path> ...] [--threshold-db <dB>]\n");
		process.exit(1);
	}

	return args;
}

interface ClipReport {
	path: string;
	totalSamples: number;
	samplePeak: number;
	samplePeakDbfs: number;
	sampleClipCount: number;
	sampleClipPct: number;
	truePeak: number;
	truePeakDbfs: number;
	trueClipCount: number;
	trueClipPct: number;
}

function analyzeFile(path: string, thresholdLin: number, sampleRate: number, channels: ReadonlyArray<Float64Array>): ClipReport {
	let samplePeak = 0;
	let sampleClipCount = 0;

	for (const channel of channels) {
		for (let i = 0; i < channel.length; i++) {
			const v = Math.abs(channel[i] ?? 0);

			if (v > samplePeak) samplePeak = v;
			if (v > thresholdLin) sampleClipCount++;
		}
	}

	// True peak: 4× polyphase upsample, count samples above threshold in the
	// upsampled domain. Use Oversampler per channel — its internal AA biquad
	// state persists across the single oversample() call.
	let truePeak = 0;
	let trueClipCount = 0;
	let totalUpsampled = 0;

	for (const channel of channels) {
		const oversampler = new Oversampler(4, sampleRate);
		// We only need the upsampled stream, not the round-trip. Pass an identity
		// function to capture upsampled samples as we go.
		// oversample(input, fn) takes the input, upsamples 4×, applies fn per
		// upsampled sample, then downsamples and returns the round-trip.
		// To count upsampled excursions we tap fn.
		oversampler.oversample(channel as unknown as Float32Array, (sample) => {
			const v = Math.abs(sample);

			if (v > truePeak) truePeak = v;
			if (v > thresholdLin) trueClipCount++;
			totalUpsampled++;

			return sample;
		});
	}

	const totalSamples = channels.reduce((sum, ch) => sum + ch.length, 0);

	return {
		path,
		totalSamples,
		samplePeak,
		samplePeakDbfs: samplePeak > 0 ? 20 * Math.log10(samplePeak) : -Infinity,
		sampleClipCount,
		sampleClipPct: (sampleClipCount / totalSamples) * 100,
		truePeak,
		truePeakDbfs: truePeak > 0 ? 20 * Math.log10(truePeak) : -Infinity,
		trueClipCount,
		trueClipPct: (trueClipCount / totalUpsampled) * 100,
	};
}

const args = parseArgs(process.argv.slice(2));
const thresholdLin = Math.pow(10, args.thresholdDb / 20);

process.stdout.write(`Threshold: ${args.thresholdDb} dBFS (linear ${thresholdLin.toFixed(4)})\n\n`);

const reports: Array<ClipReport> = [];

for (const inputArg of args.inputs) {
	const path = resolve(inputArg);
	const buffer = readFileSync(path);
	const wav = new WaveFile(new Uint8Array(buffer));

	wav.toBitDepth("32f");

	const { sampleRate } = wav.fmt;
	const samplesRaw = wav.getSamples(false, Float64Array) as Float64Array | Float64Array[];
	const channels: ReadonlyArray<Float64Array> = Array.isArray(samplesRaw) ? samplesRaw : [samplesRaw];

	process.stdout.write(`Analyzing: ${path}\n`);
	reports.push(analyzeFile(path, thresholdLin, sampleRate, channels));
}

process.stdout.write("\n");
process.stdout.write(`${"File".padEnd(50)}${"SamplePeak".padStart(14)}${"TruePeak".padStart(14)}${"SampleClips".padStart(16)}${"TrueClips".padStart(16)}\n`);
process.stdout.write("─".repeat(110) + "\n");

for (const r of reports) {
	const name = r.path.split(/[\\/]/).pop() ?? r.path;
	const samplePeakStr = `${r.samplePeakDbfs.toFixed(2)} dB`;
	const truePeakStr = `${r.truePeakDbfs.toFixed(2)} dB`;
	const sampleClipsStr = `${r.sampleClipCount.toLocaleString()} (${r.sampleClipPct.toFixed(3)}%)`;
	const trueClipsStr = `${r.trueClipCount.toLocaleString()} (${r.trueClipPct.toFixed(3)}%)`;

	process.stdout.write(`${name.padEnd(50)}${samplePeakStr.padStart(14)}${truePeakStr.padStart(14)}${sampleClipsStr.padStart(16)}${trueClipsStr.padStart(16)}\n`);
}
