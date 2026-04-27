import { z } from "zod";
import { BufferedTransformStream, TransformNode, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { processChunkThroughVstHost, spawnVstHost, StdoutByteQueue, type VstHostHandle } from "./utils/process";

/**
 * Block size (frames) used to chunk stdin/stdout traffic to the vst-host
 * subprocess. Matches the wrapper script's `--block-size` default.
 */
const VST3_BLOCK_SIZE = 4096;

export const schema = z.object({
	vstHostPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "vst-host", download: "https://github.com/visionsofparadise/vst-host" })
		.describe("vst-host — Pedalboard-based VST3 host CLI"),
	pluginPath: z
		.string()
		.meta({ input: "file", mode: "open", accept: ".vst3" })
		.describe("VST3 plugin file or bundle"),
	presetPath: z
		.string()
		.optional()
		.meta({ input: "file", mode: "open", accept: ".vstpreset" })
		.describe("Optional .vstpreset state file"),
	bypass: z.boolean().default(false).describe("Pass audio through unchanged"),
});

export interface Vst3Properties extends TransformNodeProperties {
	readonly vstHostPath: string;
	readonly pluginPath: string;
	readonly presetPath?: string;
	readonly bypass?: boolean;
	/**
	 * Extra args appended after the canonical CLI args. Test-only; allows the
	 * unit tests to spawn `node <stub.mjs>` by passing `node` as `vstHostPath`
	 * and `[stub.mjs]` here.
	 */
	readonly extraArgs?: ReadonlyArray<string>;
}

/**
 * Minimal passthrough used when `bypass: true`. Inherits the standard
 * BufferedTransformStream chunk plumbing; the no-op `_process` leaves the
 * buffer untouched so each chunk emerges unchanged sample-for-sample. The
 * subprocess is never spawned.
 */
export class Vst3PassthroughStream<P extends Vst3Properties = Vst3Properties> extends BufferedTransformStream<P> {
	override _process(_buffer: ChunkBuffer): void {
		// Bypass: leave buffer contents untouched.
	}
}

export class Vst3Stream<P extends Vst3Properties = Vst3Properties> extends BufferedTransformStream<P> {
	private streamContext?: StreamContext;
	private handle?: VstHostHandle;
	private stdoutQueue?: StdoutByteQueue;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		this.streamContext = context;

		return super._setup(input, context);
	}

	private async ensureSpawned(channels: number, sampleRate: number): Promise<{ handle: VstHostHandle; queue: StdoutByteQueue }> {
		if (this.handle && this.stdoutQueue) {
			return { handle: this.handle, queue: this.stdoutQueue };
		}

		const args: Array<string> = [
			...(this.properties.extraArgs ?? []),
			"--plugin-path",
			this.properties.pluginPath,
			"--sample-rate",
			String(sampleRate),
			"--channels",
			String(channels),
			"--block-size",
			String(VST3_BLOCK_SIZE),
		];

		if (this.properties.presetPath) {
			args.push("--preset-path", this.properties.presetPath);
		}

		const handle = spawnVstHost(this.properties.vstHostPath, args);

		try {
			await handle.ready;
		} catch (error) {
			handle.proc.kill();

			throw error;
		}

		// The byte queue must be installed *after* `ready` resolves so the
		// READY-line consumer doesn't compete with it for stdout `data` events.
		const queue = new StdoutByteQueue(handle.stdout);

		handle.proc.once("close", (code) => {
			if (code !== 0 && code !== null) {
				const stderr = Buffer.concat(handle.stderrChunks).toString();

				queue.closeWithError(new Error(`vst-host exited with code ${code}: ${stderr}`));
			}
		});

		this.handle = handle;
		this.stdoutQueue = queue;

		return { handle, queue };
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.streamContext) throw new Error("Vst3Stream._process called before setup()");

		const frames = buffer.frames;

		if (frames === 0) return;

		const channels = buffer.channels;
		const sampleRate = this.sampleRate ?? 44100;

		const { handle, queue } = await this.ensureSpawned(channels, sampleRate);

		const chunk = await buffer.read(0, frames);
		const inputSamples = chunk.samples;

		// The framework guarantees `frames === bufferSize` for every call
		// except the final one at end-of-stream (which may be a partial
		// trailing block). Build a full VST3_BLOCK_SIZE block; zero-pad only
		// when frames < VST3_BLOCK_SIZE (end-of-stream only — plugin state
		// contamination from trailing zeros is harmless after the last
		// real sample).
		const blockInput: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			if (frames === VST3_BLOCK_SIZE) {
				blockInput.push(inputSamples[ch] ?? new Float32Array(VST3_BLOCK_SIZE));
			} else {
				const padded = new Float32Array(VST3_BLOCK_SIZE);
				const src = inputSamples[ch];

				if (src) padded.set(src.subarray(0, frames));

				blockInput.push(padded);
			}
		}

		const blockOutput = await processChunkThroughVstHost(handle, queue, blockInput, VST3_BLOCK_SIZE, channels);

		// Truncate the plugin's response back to the real frame count
		// (drops any tail-into-zero output beyond the real input length).
		const output: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const src = blockOutput[ch];

			output.push(src ? Float32Array.from(src.subarray(0, frames)) : new Float32Array(frames));
		}

		await buffer.truncate(0);
		await buffer.append(output);
	}

	override async _teardown(): Promise<void> {
		const handle = this.handle;

		if (!handle) return;

		this.handle = undefined;
		this.stdoutQueue = undefined;

		try {
			handle.stdin.end();
		} catch {
			// Already closed.
		}

		await new Promise<void>((resolve) => {
			if (handle.proc.exitCode !== null || handle.proc.signalCode !== null) {
				resolve();

				return;
			}

			handle.proc.once("close", () => {
				resolve();
			});

			// Final safety: if the subprocess never closes, kill after a grace
			// period. Captured via stderr for diagnostics.
			const killTimer = setTimeout(() => {
				handle.proc.kill();
			}, 5_000);

			handle.proc.once("close", () => {
				clearTimeout(killTimer);
			});
		});

		const exitCode = handle.proc.exitCode;

		if (exitCode !== null && exitCode !== 0) {
			const stderr = Buffer.concat(handle.stderrChunks).toString();

			throw new Error(`vst-host exited with code ${exitCode}: ${stderr}`);
		}
	}
}

export class Vst3Node<P extends Vst3Properties = Vst3Properties> extends TransformNode<P> {
	static override readonly moduleName: string = "VST3";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription: string = "Host a VST3 effect plugin via Pedalboard";
	static override readonly schema: z.ZodType = schema;
	static override is(value: unknown): value is Vst3Node {
		return TransformNode.is(value) && value.type[2] === "vst3";
	}

	override readonly type: ReadonlyArray<string> = ["buffered-audio-node", "transform", "vst3"];

	constructor(properties: P) {
		super({ bufferSize: VST3_BLOCK_SIZE, ...properties });
	}

	override createStream(): BufferedTransformStream<P> {
		const overlap = this.properties.overlap ?? 0;

		if (this.properties.bypass === true) {
			return new Vst3PassthroughStream<P>({ ...this.properties, bufferSize: this.bufferSize, overlap });
		}

		return new Vst3Stream<P>({ ...this.properties, bufferSize: this.bufferSize, overlap });
	}

	override clone(overrides?: Partial<P>): Vst3Node<P> {
		return new Vst3Node({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function vst3(options: {
	vstHostPath: string;
	pluginPath: string;
	presetPath?: string;
	bypass?: boolean;
	id?: string;
	extraArgs?: ReadonlyArray<string>;
}): Vst3Node {
	return new Vst3Node({
		vstHostPath: options.vstHostPath,
		pluginPath: options.pluginPath,
		presetPath: options.presetPath,
		bypass: options.bypass ?? false,
		id: options.id,
		extraArgs: options.extraArgs,
	});
}
