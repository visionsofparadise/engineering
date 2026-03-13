import { spawn } from "node:child_process";

/**
 * Resample audio channels by spawning ffmpeg directly.
 * This avoids TransformStream nesting deadlocks when called from within _process().
 */
export function resampleDirect(
	ffmpegPath: string,
	channels: Array<Float32Array>,
	sourceSampleRate: number,
	targetSampleRate: number,
): Promise<Array<Float32Array>> {
	if (sourceSampleRate === targetSampleRate) {
		return Promise.resolve(channels.map((ch) => ch.slice()));
	}

	const numChannels = channels.length;
	const frames = channels[0]?.length ?? 0;

	if (frames === 0 || numChannels === 0) {
		return Promise.resolve(channels);
	}

	return new Promise<Array<Float32Array>>((resolve, reject) => {
		const args = [
			"-f", "f32le",
			"-ar", String(sourceSampleRate),
			"-ac", String(numChannels),
			"-i", "pipe:0",
			"-af", `aresample=${targetSampleRate}:resampler=soxr:dither_method=triangular`,
			"-f", "f32le",
			"-ar", String(targetSampleRate),
			"-ac", String(numChannels),
			"pipe:1",
		];

		const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });

		if (!proc.stdout || !proc.stderr || !proc.stdin) {
			reject(new Error("Failed to create ffmpeg stdio streams"));
			return;
		}

		const stdout = proc.stdout;
		const stdin = proc.stdin;
		const outputChunks: Array<Buffer> = [];
		const stderrChunks: Array<Buffer> = [];

		stdout.on("data", (chunk: Buffer) => outputChunks.push(chunk));
		proc.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

		proc.on("error", (error) => {
			reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				const stderrOutput = Buffer.concat(stderrChunks).toString();
				reject(new Error(`ffmpeg exited with code ${code}: ${stderrOutput}`));
				return;
			}

			const outputBuffer = Buffer.concat(outputChunks);
			const totalSamples = outputBuffer.length / 4;
			const outFrames = Math.floor(totalSamples / numChannels);
			const result: Array<Float32Array> = [];

			for (let ch = 0; ch < numChannels; ch++) {
				result.push(new Float32Array(outFrames));
			}

			const view = new Float32Array(outputBuffer.buffer, outputBuffer.byteOffset, totalSamples);

			for (let frame = 0; frame < outFrames; frame++) {
				for (let ch = 0; ch < numChannels; ch++) {
					const arr = result[ch];
					const val = view[frame * numChannels + ch];
					if (arr && val !== undefined) arr[frame] = val;
				}
			}

			resolve(result);
		});

		stdin.on("error", () => {
			// Ignore EPIPE — expected when ffmpeg closes stdin early
		});

		// Interleave and write
		const interleaved = new Float32Array(frames * numChannels);

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < numChannels; ch++) {
				interleaved[frame * numChannels + ch] = channels[ch]?.[frame] ?? 0;
			}
		}

		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);
		stdin.write(buf, () => stdin.end());
	});
}
