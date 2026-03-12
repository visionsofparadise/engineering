import { spawn, type ChildProcess } from "node:child_process";
import { z } from "zod";
import { AudioChunk, StreamMeta } from "../module";
import { SourceModule, type SourceModuleProperties } from "../source";

export const schema = z.object({
	path: z.string().default("").meta({ input: "file", mode: "open" }),
	ffmpegPath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffmpeg" }).describe("FFmpeg Path"),
	ffprobePath: z.string().default("").meta({ input: "file", mode: "open", binary: "ffprobe" }).describe("FFprobe Path"),
});

export interface TranscodeReadProperties extends z.infer<typeof schema>, SourceModuleProperties {
	readonly channels?: ReadonlyArray<number>;
}

const DEFAULT_CHUNK_SIZE = 44100;

interface ProbeResult {
	readonly sampleRate: number;
	readonly channels: number;
	readonly duration: number;
}

export class TranscodeReadModule extends SourceModule<TranscodeReadProperties> {
	static override readonly moduleName = "Transcode Read";
	static override readonly moduleDescription = "Read audio from a file";
	static override readonly schema = schema;
	override readonly type = ["async-module", "source", "transcode-read"] as const;

	readonly bufferSize = 0;
	readonly latency = 0;

	private ffmpegProcess?: ChildProcess;
	private stdout?: NodeJS.ReadableStream;
	private outputChannels = 0;
	private frameOffset = 0;
	private remainder?: Buffer;

	async _init(): Promise<StreamMeta> {
		const ffprobePath = this.properties.ffprobePath;
		const ffmpegPath = this.properties.ffmpegPath;

		const probe = await this.probe(ffprobePath, this.properties.path);
		const selectedChannels = this.properties.channels;
		this.outputChannels = selectedChannels ? selectedChannels.length : probe.channels;

		const args = [
			"-i", this.properties.path,
			"-f", "f32le",
			"-acodec", "pcm_f32le",
			"-ar", String(probe.sampleRate),
		];

		if (selectedChannels) {
			const panParts = selectedChannels.map((srcCh, outCh) => `c${outCh}=c${srcCh}`);
			const layout = this.outputChannels === 1 ? "mono" : `${this.outputChannels}c`;
			args.push("-af", `pan=${layout}|${panParts.join("|")}`);
			args.push("-ac", String(this.outputChannels));
		} else {
			args.push("-ac", String(probe.channels));
		}

		args.push("pipe:1");

		const proc = spawn(ffmpegPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.ffmpegProcess = proc;
		this.stdout = proc.stdout;
		this.remainder = undefined;
		this.frameOffset = 0;

		proc.stderr.resume();

		return {
			sampleRate: probe.sampleRate,
			channels: this.outputChannels,
			duration: probe.duration,
		};
	}

	async _read(controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		const bytesPerFrame = this.outputChannels * 4;
		const targetBytes = DEFAULT_CHUNK_SIZE * bytesPerFrame;

		const data = await this.readBytes(targetBytes);

		if (!data || data.length === 0) {
			controller.close();
			return;
		}

		const usableBytes = Math.floor(data.length / bytesPerFrame) * bytesPerFrame;
		if (usableBytes === 0) {
			controller.close();
			return;
		}

		const leftover = data.length - usableBytes;
		if (leftover > 0) {
			this.remainder = Buffer.from(data.buffer, data.byteOffset + usableBytes, leftover);
		}

		const frames = usableBytes / bytesPerFrame;
		const floats = new Float32Array(data.buffer, data.byteOffset, usableBytes / 4);

		const samples: Array<Float32Array> = [];
		for (let ch = 0; ch < this.outputChannels; ch++) {
			samples.push(new Float32Array(frames));
		}

		for (let frame = 0; frame < frames; frame++) {
			for (let ch = 0; ch < this.outputChannels; ch++) {
				const channel = samples[ch];
				const value = floats[frame * this.outputChannels + ch];
				if (channel && value !== undefined) {
					channel[frame] = value;
				}
			}
		}

		const offset = this.frameOffset;
		this.frameOffset += frames;

		controller.enqueue({
			samples,
			offset,
			duration: frames,
		});
	}

	async _flush(_controller: ReadableStreamDefaultController<AudioChunk>): Promise<void> {
		const proc = this.ffmpegProcess;
		if (proc) {
			await new Promise<void>((resolve) => {
				proc.on("close", () => resolve());
				if (proc.exitCode !== null) resolve();
			});
			this.ffmpegProcess = undefined;
		}
		this.stdout = undefined;
		this.remainder = undefined;
	}

	private async probe(ffprobePath: string, filePath: string): Promise<ProbeResult> {
		const proc = spawn(ffprobePath, [
			"-v", "quiet",
			"-print_format", "json",
			"-show_streams",
			"-select_streams", "a:0",
			filePath,
		], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const chunks: Array<Buffer> = [];

		proc.stdout.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});

		proc.stderr.resume();

		await new Promise<void>((resolve, reject) => {
			proc.on("close", (code) => {
				if (code !== 0) {
					reject(new Error(`ffprobe exited with code ${code} for "${filePath}"`));
				} else {
					resolve();
				}
			});
			proc.on("error", (error) => {
				reject(new Error(`Failed to spawn ffprobe: ${error.message}`));
			});
		});

		const json = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
			streams?: Array<{
				sample_rate?: string;
				channels?: number;
				duration?: string;
			}>;
		};

		const stream = json.streams?.[0];
		if (!stream) {
			throw new Error(`No audio stream found in "${filePath}"`);
		}

		return {
			sampleRate: Number(stream.sample_rate) || 44100,
			channels: stream.channels ?? 1,
			duration: Number(stream.duration) || 0,
		};
	}

	private readBytes(targetBytes: number): Promise<Buffer | undefined> {
		return new Promise((resolve) => {
			const stdout = this.stdout;
			if (!stdout) {
				resolve(undefined);
				return;
			}

			const existing = this.remainder;
			this.remainder = undefined;

			const read = (): void => {
				const raw = stdout.read(targetBytes - (existing?.length ?? 0)) as Buffer | null;

				if (raw) {
					resolve(existing ? Buffer.concat([existing, raw]) : raw);
					return;
				}

				if ((stdout as NodeJS.ReadableStream & { readableEnded?: boolean }).readableEnded) {
					resolve(existing && existing.length > 0 ? existing : undefined);
					return;
				}

				const onReadable = (): void => {
					cleanup();
					read();
				};
				const onEnd = (): void => {
					cleanup();
					resolve(existing && existing.length > 0 ? existing : undefined);
				};
				const cleanup = (): void => {
					stdout.removeListener("readable", onReadable);
					stdout.removeListener("end", onEnd);
				};

				stdout.once("readable", onReadable);
				stdout.once("end", onEnd);
			};

			read();
		});
	}

	clone(overrides?: Partial<TranscodeReadProperties>): TranscodeReadModule {
		return new TranscodeReadModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function transcodeRead(
	ffmpegPath: string,
	ffprobePath: string,
	path: string,
	options?: { channels?: ReadonlyArray<number> },
): TranscodeReadModule {
	return new TranscodeReadModule({ path, ffmpegPath, ffprobePath, channels: options?.channels });
}
