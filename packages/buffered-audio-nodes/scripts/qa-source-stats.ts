/**
 * Statistical analysis of a WAV source. Reports the |x| distribution as
 * percentile-bounded bins with min/max amplitude per bin, plus floor/median/
 * peak landmarks relevant to loudnessCurve tuning.
 *
 * Usage: tsx qa-source-stats.ts <wav-path> [--floor <dB>]
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { WaveFile } = require("wavefile") as { WaveFile: new (data?: Uint8Array) => { fromScratch: (...args: Array<unknown>) => void; toBitDepth: (depth: string) => void; getSamples: (interleaved: boolean, ctor: typeof Float64Array) => Float64Array | Array<Float64Array>; fmt: { sampleRate: number; numChannels: number } } };

interface Args {
	input: string;
	floorDb: number;
}

function parseArgs(argv: ReadonlyArray<string>): Args {
	const args: Partial<Args> = {};

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];

		if (flag === "--floor") {
			args.floorDb = Number.parseFloat(argv[index + 1] ?? "-60");
			index++;
		} else if (!flag.startsWith("--")) {
			args.input = flag;
		}
	}

	if (!args.input) {
		process.stderr.write("Usage: tsx qa-source-stats.ts <wav-path> [--floor <dB>]\n");
		process.exit(1);
	}

	return { input: resolve(args.input), floorDb: args.floorDb ?? -60 };
}

function toDb(linear: number): string {
	if (linear <= 0) return "−∞   ";
	const db = 20 * Math.log10(linear);

	return `${db >= 0 ? " " : ""}${db.toFixed(2)}`;
}

function pad(s: string, n: number): string {
	return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
	return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

const { input, floorDb } = parseArgs(process.argv.slice(2));
const floorLinear = Math.pow(10, floorDb / 20);

process.stdout.write(`Reading: ${input}\n`);

const buffer = readFileSync(input);
const wav = new WaveFile(new Uint8Array(buffer));

wav.toBitDepth("32f");

const fmt = wav.fmt as { sampleRate: number; numChannels: number };
const sampleRate = fmt.sampleRate;
const channelCount = fmt.numChannels;
const samplesRaw = wav.getSamples(false, Float64Array);
const channels: ReadonlyArray<Float64Array> = Array.isArray(samplesRaw) ? samplesRaw : [samplesRaw];
const framesPerChannel = channels[0]?.length ?? 0;
const totalSamples = framesPerChannel * channelCount;

process.stdout.write(`Sample rate: ${sampleRate} Hz\n`);
process.stdout.write(`Channels: ${channelCount}\n`);
process.stdout.write(`Frames per channel: ${framesPerChannel.toLocaleString()}\n`);
process.stdout.write(`Duration: ${(framesPerChannel / sampleRate).toFixed(2)} s\n`);
process.stdout.write(`Total samples (across channels): ${totalSamples.toLocaleString()}\n`);
process.stdout.write(`Floor: ${floorDb} dB (linear ${floorLinear.toExponential(3)})\n`);
process.stdout.write("\n");

// Collapse channels into a single |x| array.
const absX = new Float32Array(totalSamples);
let writeIdx = 0;

for (const channel of channels) {
	for (let frameIndex = 0; frameIndex < channel.length; frameIndex++) {
		absX[writeIdx++] = Math.abs(channel[frameIndex] ?? 0);
	}
}

absX.sort();

// Find boundary between below-floor and above-floor samples.
let firstAboveFloor = absX.length;

for (let index = 0; index < absX.length; index++) {
	if ((absX[index] ?? 0) >= floorLinear) {
		firstAboveFloor = index;
		break;
	}
}

const belowFloor = firstAboveFloor;
const belowFloorPct = (belowFloor / absX.length) * 100;

// Stats are computed on the above-floor portion only — that's what the curve sees.
const aboveFloor = absX.subarray(firstAboveFloor);

// 20 equal-width percentile bins (every 5%) within the above-floor population.
// Catches the body distribution shape clearly without biasing toward tails.
const percentiles: Array<number> = [];

for (let p = 0; p <= 100; p += 5) percentiles.push(p);

function valueAtPercentile(p: number): number {
	if (aboveFloor.length === 0) return 0;
	const idx = Math.max(0, Math.min(Math.floor((p / 100) * (aboveFloor.length - 1)), aboveFloor.length - 1));

	return aboveFloor[idx] ?? 0;
}

const median = valueAtPercentile(50);
const peak = aboveFloor[aboveFloor.length - 1] ?? 0;

// Header: percentile landmarks.
process.stdout.write(`PERCENTILE LANDMARKS (above-floor population — ${aboveFloor.length.toLocaleString()} samples)\n`);
process.stdout.write("─────────────────────────────────────────────────────────\n");
process.stdout.write(`${pad("Percentile", 12)}${pad("|x| linear", 16)}${pad("|x| dBFS", 12)} Notes\n`);
process.stdout.write("─────────────────────────────────────────────────────────\n");

for (const p of percentiles) {
	const v = valueAtPercentile(p);
	const notes: Array<string> = [];

	if (Math.abs(p - 50) < 0.01) notes.push("median — curve peak anchor");
	if (Math.abs(p - 100) < 0.01) notes.push("peak — curve max anchor");

	const pLabel = `${p.toFixed(p < 1 || p > 99 ? 2 : 0)}%`;

	process.stdout.write(`${padLeft(pLabel, 11)} ${pad(v.toExponential(3), 16)}${pad(toDb(v) + " dB", 12)} ${notes.join(", ")}\n`);
}

process.stdout.write("\n");

// Bin view: ranges between percentiles (above-floor only).
process.stdout.write("BIN RANGES (consecutive percentile bands within above-floor population)\n");
process.stdout.write("─────────────────────────────────────────────────────────────────────────────\n");
process.stdout.write(`${pad("Bin (%)", 14)}${pad("Min |x|", 14)}${pad("Max |x|", 14)} dB range\n`);
process.stdout.write("─────────────────────────────────────────────────────────────────────────────\n");

for (let index = 0; index < percentiles.length - 1; index++) {
	const pLow = percentiles[index] ?? 0;
	const pHigh = percentiles[index + 1] ?? 0;
	const minV = valueAtPercentile(pLow);
	const maxV = valueAtPercentile(pHigh);
	const binLabel = `${pLow.toFixed(pLow < 1 ? 2 : 0)}–${pHigh.toFixed(pHigh < 1 || pHigh > 99 ? 2 : 0)}`;
	const dbRange = `${toDb(minV)} → ${toDb(maxV)} dB`;

	process.stdout.write(`${pad(binLabel, 14)}${pad(minV.toExponential(3), 14)}${pad(maxV.toExponential(3), 14)} ${dbRange}\n`);
}

process.stdout.write("\n");

// Curve geometry summary.
process.stdout.write("CURVE GEOMETRY (with floor anchor)\n");
process.stdout.write("─────────────────────────────────────────────────────────\n");
process.stdout.write(`Floor anchor:   ${floorLinear.toExponential(3)}  (${floorDb} dB)\n`);
process.stdout.write(`Median (peak):  ${median.toExponential(3)}  (${toDb(median)} dB)\n`);
process.stdout.write(`Peak anchor:    ${peak.toExponential(3)}  (${toDb(peak)} dB)\n`);
process.stdout.write(`\n`);
process.stdout.write(`Below-floor samples: ${belowFloor.toLocaleString()} / ${absX.length.toLocaleString()} (${belowFloorPct.toFixed(2)}%)\n`);
process.stdout.write(`Body span (floor → peak): ${(20 * Math.log10(peak / floorLinear)).toFixed(2)} dB\n`);
process.stdout.write(`Lift segment (floor → median): ${(20 * Math.log10(median / floorLinear)).toFixed(2)} dB\n`);
process.stdout.write(`Headroom segment (median → peak): ${(20 * Math.log10(peak / median)).toFixed(2)} dB\n`);
