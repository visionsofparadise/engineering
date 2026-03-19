import { spawn } from "node:child_process";
import { z } from "zod";
import type { ChunkBuffer } from "../../chunk-buffer";
import type { StreamContext } from "../../node";
import { interleave } from "../../utils/interleave";
import { FfmpegNode, FfmpegStream, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg", download: "https://ffmpeg.org/download.html" }).describe("FFmpeg — audio/video processing tool"),
	target: z.number().min(-50).max(0).multipleOf(0.1).default(-14).describe("Target"),
	truePeak: z.number().min(-10).max(0).multipleOf(0.1).default(-1).describe("True Peak"),
	lra: z.number().min(0).max(20).multipleOf(0.1).default(0).describe("LRA"),
});

export interface LoudnessProperties extends FfmpegProperties {
	readonly target: number;
	readonly truePeak: number;
	readonly lra?: number;
}

export class LoudnessStream extends FfmpegStream<LoudnessProperties> {
	private measuredValues?: {
		inputI: string;
		inputTp: string;
		inputLra: string;
		inputThresh: string;
		targetOffset: string;
	};

	protected override _buildArgs(_context: StreamContext): Array<string> {
		return this.buildArgsWithMeasurement();
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const props = this.properties;
		this.measuredValues = await measureLoudness(buffer, this.context, props);

		await super._process(buffer);

		this.measuredValues = undefined;
	}

	private buildArgsWithMeasurement(): Array<string> {
		const props = this.properties;
		const { target, truePeak, lra } = props;

		if (this.measuredValues) {
			const { inputI, inputTp, inputLra, inputThresh, targetOffset } = this.measuredValues;
			const parts = [
				`I=${target}`,
				`TP=${truePeak}`,
				lra !== undefined ? `LRA=${lra}` : "",
				`measured_I=${inputI}`,
				`measured_TP=${inputTp}`,
				`measured_LRA=${inputLra}`,
				`measured_thresh=${inputThresh}`,
				`offset=${targetOffset}`,
				"linear=true",
			].filter(Boolean);

			return ["-af", `loudnorm=${parts.join(":")}`];
		}

		const parts = [`I=${target}`, `TP=${truePeak}`, lra !== undefined ? `LRA=${lra}` : ""].filter(Boolean);

		return ["-af", `loudnorm=${parts.join(":")}`];
	}
}

export class LoudnessNode extends FfmpegNode<LoudnessProperties> {
	static override readonly moduleName = "Loudness";
	static override readonly moduleDescription = "Measure integrated, short-term, and momentary loudness";
	static override readonly schema = schema;
	static override is(value: unknown): value is LoudnessNode {
		return FfmpegNode.is(value) && value.type[3] === "loudness";
	}

	override readonly type = ["async-module", "transform", "ffmpeg", "loudness"] as const;

	protected override createStream(context: StreamContext): LoudnessStream {
		return new LoudnessStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	override clone(overrides?: Partial<LoudnessProperties>): LoudnessNode {
		return new LoudnessNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

async function measureLoudness(
	buffer: ChunkBuffer,
	context: StreamContext,
	properties: LoudnessProperties,
): Promise<{
	inputI: string;
	inputTp: string;
	inputLra: string;
	inputThresh: string;
	targetOffset: string;
}> {
	const binaryPath = properties.ffmpegPath;

	const parts = [`I=${properties.target}`, `TP=${properties.truePeak}`, properties.lra !== undefined ? `LRA=${properties.lra}` : "", "print_format=json"].filter(Boolean);

	const args = ["-f", "f32le", "-ar", String(context.sampleRate), "-ac", String(context.channels), "-i", "pipe:0", "-af", `loudnorm=${parts.join(":")}`, "-f", "null", "-"];

	return new Promise((resolve, reject) => {
		const proc = spawn(binaryPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdin = proc.stdin;
		const stderrStream = proc.stderr;

		const stderrChunks: Array<Buffer> = [];

		stderrStream.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		proc.on("error", (error) => {
			reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
		});

		proc.on("close", (code) => {
			const stderr = Buffer.concat(stderrChunks).toString();

			if (code !== 0) {
				reject(new Error(`ffmpeg measurement pass exited with code ${code}: ${stderr}`));
				return;
			}

			const jsonMatch = /\{[^}]*"input_i"[^}]*\}/s.exec(stderr);

			if (!jsonMatch) {
				reject(new Error("Failed to parse loudnorm measurement output"));
				return;
			}

			const measured = JSON.parse(jsonMatch[0]) as Record<string, string>;

			resolve({
				inputI: measured.input_i ?? "0",
				inputTp: measured.input_tp ?? "0",
				inputLra: measured.input_lra ?? "0",
				inputThresh: measured.input_thresh ?? "0",
				targetOffset: measured.target_offset ?? "0",
			});
		});

		void writeToStdin(stdin, buffer, context);
	});
}

async function writeToStdin(stdin: NodeJS.WritableStream, buffer: ChunkBuffer, context: StreamContext): Promise<void> {
	for await (const chunk of buffer.iterate(44100)) {
		const interleaved = interleave(chunk.samples, chunk.duration, context.channels);
		const buf = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength);

		const canWrite = stdin.write(buf);

		if (!canWrite) {
			await new Promise<void>((resolve) => {
				stdin.once("drain", resolve);
			});
		}
	}

	stdin.end();
}

export function loudness(ffmpegPath: string, options?: { target?: number; truePeak?: number; lra?: number; id?: string }): LoudnessNode {
	return new LoudnessNode({
		ffmpegPath,
		target: options?.target ?? -14,
		truePeak: options?.truePeak ?? -1,
		lra: options?.lra,
		id: options?.id,
	});
}
