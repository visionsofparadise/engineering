#!/usr/bin/env node
// Stub `vst-host` binary for unit tests. Mimics the contract of the real
// vst-host CLI just enough for the Vst3Stream lifecycle tests:
//   1. Print `READY\n` once startup is "complete".
//   2. Echo stdin -> stdout verbatim, in chunks of `--block-size * --channels * 4` bytes.
//   3. Exit cleanly when stdin closes.
//
// Real audio processing (plugin load, Pedalboard, numpy) is out of scope —
// this fixture exists to verify the spawn / READY / process / teardown flow.

import process from "node:process";

const args = process.argv.slice(2);

function readArg(name, fallback) {
	const idx = args.indexOf(name);

	if (idx === -1) return fallback;

	return args[idx + 1];
}

const blockSize = Number.parseInt(readArg("--block-size", "4096"), 10);
const channels = Number.parseInt(readArg("--channels", "1"), 10);

if (!Number.isFinite(blockSize) || blockSize <= 0) {
	process.stderr.write(`stub-binary: invalid --block-size ${String(blockSize)}\n`);
	process.exit(2);
}

if (!Number.isFinite(channels) || channels <= 0) {
	process.stderr.write(`stub-binary: invalid --channels ${String(channels)}\n`);
	process.exit(2);
}

const bytesPerBlock = blockSize * channels * 4;

process.stdout.write("READY\n");

let buffered = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
	buffered = Buffer.concat([buffered, chunk]);

	while (buffered.length >= bytesPerBlock) {
		const block = buffered.subarray(0, bytesPerBlock);

		buffered = buffered.subarray(bytesPerBlock);
		process.stdout.write(block);
	}
});

process.stdin.on("end", () => {
	// Drop any trailing partial-block bytes — matches the real wrapper's
	// floor-to-whole-frames behaviour.
	process.exit(0);
});
