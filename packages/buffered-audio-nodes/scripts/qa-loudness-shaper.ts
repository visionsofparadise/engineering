/**
 * QA driver for the loudnessShaper node.
 *
 * Renders the input WAV through loudnessShaper in one of two modes
 * (preserve-peaks default, expander when --no-preserve-peaks). Optionally
 * also renders a side-by-side loudnessNormalize baseline for A/B (pass
 * --skip-normalize to suppress).
 *
 * All renders use 32-bit float WAV output to preserve the chain's full
 * dynamic range (expander-mode renders may produce |x| > 1.0).
 *
 * Output filenames:
 *   058-shaper.wav            — preservePeaks=true, warmth=0
 *   058-shaper-expander.wav   — preservePeaks=false, warmth=0
 *   058-shaper-w<W>.wav       — preservePeaks=true, warmth>0
 *   058-shaper-expander-w<W>.wav  — preservePeaks=false, warmth>0
 *   058-normalize.wav         — loudnessNormalize baseline
 *
 * Run from anywhere; module resolution works because this script lives
 * inside the buffered-audio-nodes package.
 */
import { resolve } from "node:path";
import { read } from "../src/sources/read";
import { write } from "../src/targets/write";
import { loudnessNormalize } from "../src/transforms/loudness-normalize";
import { loudnessShaper } from "../src/transforms/loudness-shaper";

interface Args {
	input: string;
	outDir: string;
	target: number;
	floor: number;
	bodyLow: number;
	bodyHigh: number;
	warmth: number;
	preservePeaks: boolean;
	skipNormalize: boolean;
}

function usage(): never {
	process.stderr.write(
		"Usage: tsx qa-loudness-shaper.ts \\\n" +
		"  --input <wav> --out-dir <dir> \\\n" +
		"  --floor <dB> --body-low <dB> --body-high <dB> \\\n" +
		"  [--target <dB LUFS, default -16>] \\\n" +
		"  [--warmth <0..1, default 0>] \\\n" +
		"  [--preserve-peaks | --no-preserve-peaks] (default --preserve-peaks) \\\n" +
		"  [--skip-normalize]\n",
	);
	process.exit(1);
}

function parseArgs(argv: ReadonlyArray<string>): Args {
	const args: Partial<Args> = {};

	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];

		if (flag === "--input") {
			args.input = argv[index + 1];
			index++;
		} else if (flag === "--out-dir") {
			args.outDir = argv[index + 1];
			index++;
		} else if (flag === "--target") {
			args.target = Number.parseFloat(argv[index + 1] ?? "-16");
			index++;
		} else if (flag === "--floor") {
			args.floor = Number.parseFloat(argv[index + 1] ?? "");
			index++;
		} else if (flag === "--body-low") {
			args.bodyLow = Number.parseFloat(argv[index + 1] ?? "");
			index++;
		} else if (flag === "--body-high") {
			args.bodyHigh = Number.parseFloat(argv[index + 1] ?? "");
			index++;
		} else if (flag === "--warmth") {
			args.warmth = Number.parseFloat(argv[index + 1] ?? "0");
			index++;
		} else if (flag === "--preserve-peaks") {
			args.preservePeaks = true;
		} else if (flag === "--no-preserve-peaks") {
			args.preservePeaks = false;
		} else if (flag === "--skip-normalize") {
			args.skipNormalize = true;
		} else if (flag === "--help" || flag === "-h") {
			usage();
		}
	}

	if (
		!args.input
		|| !args.outDir
		|| args.floor === undefined
		|| args.bodyLow === undefined
		|| args.bodyHigh === undefined
		|| Number.isNaN(args.floor)
		|| Number.isNaN(args.bodyLow)
		|| Number.isNaN(args.bodyHigh)
	) {
		usage();
	}

	return {
		input: resolve(args.input),
		outDir: resolve(args.outDir),
		target: args.target ?? -16,
		floor: args.floor,
		bodyLow: args.bodyLow,
		bodyHigh: args.bodyHigh,
		warmth: args.warmth ?? 0,
		preservePeaks: args.preservePeaks ?? true,
		skipNormalize: args.skipNormalize ?? false,
	};
}

interface RenderJob {
	readonly label: string;
	readonly outFile: string;
	build(): { transform: ReturnType<typeof loudnessNormalize> | ReturnType<typeof loudnessShaper>; description: string };
}

function buildJobs(args: Args): Array<RenderJob> {
	const { target, floor, bodyLow, bodyHigh, warmth, preservePeaks, skipNormalize } = args;
	const jobs: Array<RenderJob> = [];

	if (!skipNormalize) {
		jobs.push({
			label: "normalize",
			outFile: "058-normalize.wav",
			build: () => ({
				transform: loudnessNormalize({ target }),
				description: `loudnessNormalize target=${target}`,
			}),
		});
	}

	// Filename suffix tags non-default warmth so different runs don't
	// overwrite. warmth=0 keeps the bare 058-shaper(.wav | -expander.wav) names.
	const warmthTag = warmth === 0 ? "" : `-w${warmth}`;
	const modeTag = preservePeaks ? "" : "-expander";
	const outFile = `058-shaper${modeTag}${warmthTag}.wav`;
	const label = `shaper${modeTag}${warmthTag}`;

	jobs.push({
		label,
		outFile,
		build: () => ({
			transform: loudnessShaper({ target, floor, bodyLow, bodyHigh, warmth, preservePeaks }),
			description:
				`loudnessShaper target=${target} floor=${floor} bodyLow=${bodyLow} bodyHigh=${bodyHigh} `
				+ `warmth=${warmth} preservePeaks=${String(preservePeaks)}`,
		}),
	});

	return jobs;
}

async function runJob(job: RenderJob, input: string, outDir: string): Promise<void> {
	const outPath = resolve(outDir, job.outFile);
	const { transform, description } = job.build();
	const startMs = Date.now();

	process.stdout.write(`\n[${job.label}] ${description}\n`);
	process.stdout.write(`[${job.label}] -> ${outPath}\n`);

	const source = read(input);
	const sink = write(outPath, { bitDepth: "32f" });

	source.to(transform);
	transform.to(sink);

	await source.render();

	const elapsedMs = Date.now() - startMs;

	process.stdout.write(`[${job.label}] done in ${(elapsedMs / 1000).toFixed(1)}s\n`);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	process.stdout.write(`Input:          ${args.input}\n`);
	process.stdout.write(`Out dir:        ${args.outDir}\n`);
	process.stdout.write(`Target:         ${args.target} LUFS\n`);
	process.stdout.write(`Floor:          ${args.floor} dB\n`);
	process.stdout.write(`Body low:       ${args.bodyLow} dB\n`);
	process.stdout.write(`Body high:      ${args.bodyHigh} dB\n`);
	process.stdout.write(`Warmth:         ${args.warmth}\n`);
	process.stdout.write(`Preserve peaks: ${String(args.preservePeaks)}\n`);
	process.stdout.write(`Skip normalize: ${String(args.skipNormalize)}\n`);

	for (const job of buildJobs(args)) {
		await runJob(job, args.input, args.outDir);
	}

	process.stdout.write("\nAll renders complete.\n");
}

await main();
