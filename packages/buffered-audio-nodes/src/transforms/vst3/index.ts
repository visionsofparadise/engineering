import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type StreamContext, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { processWholeFileThroughVstHost, spawnVstHost, writeStagesJson, type VstHostHandle, type VstStage } from "./utils/process";

export const stageSchema = z.object({
	pluginPath: z
		.string()
		.meta({ input: "file", mode: "open", accept: ".vst3" })
		.describe("VST3 plugin file or bundle"),
	pluginName: z
		.string()
		.optional()
		.describe("Sub-plugin name when pluginPath is a multi-plugin shell (e.g. WaveShell)"),
	presetPath: z
		.string()
		.optional()
		.meta({ input: "file", mode: "open", accept: ".vstpreset" })
		.describe("Optional .vstpreset state file applied after the plugin loads"),
	parameters: z
		.record(z.string(), z.union([z.number(), z.string(), z.boolean()]))
		.optional()
		.describe("Optional parameter overrides applied after presetPath. Keys map to Pedalboard parameter names exposed by the plugin."),
});

export const schema = z.object({
	vstHostPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "vst-host", download: "https://github.com/visionsofparadise/vst-host" })
		.describe("vst-host — Pedalboard-based VST3 host CLI"),
	stages: z
		.array(stageSchema)
		.min(1)
		.describe("Ordered chain of plugin/preset stages — processed end-to-end inside one Pedalboard offline call"),
	bypass: z.boolean().default(false).describe("Pass audio through unchanged (no subprocess spawn)"),
});

export interface Vst3Properties extends TransformNodeProperties {
	readonly vstHostPath: string;
	readonly stages: ReadonlyArray<VstStage>;
	readonly bypass?: boolean;
	/**
	 * Extra args appended after the canonical CLI args. Test-only; allows the
	 * unit tests to spawn `node <stub.mjs>` by passing `node` as `vstHostPath`
	 * and `[stub.mjs]` here.
	 */
	readonly extraArgs?: ReadonlyArray<string>;
}

/**
 * Bypass stream: leaves the buffer untouched. No subprocess spawn, no plugin
 * load. Used when the node is configured with `bypass: true`.
 */
export class Vst3PassthroughStream<P extends Vst3Properties = Vst3Properties> extends BufferedTransformStream<P> {
	override _process(_buffer: ChunkBuffer): void {
		// Bypass: leave buffer contents untouched.
	}
}

/**
 * Whole-file VST3 chain stream. The framework drives `_process` exactly once
 * (after the upstream EOF flushes the accumulated buffer at `bufferSize:
 * WHOLE_FILE`). We hand the entire buffer to a `vst-host` subprocess that
 * runs Pedalboard's offline mode (`reset=True`) over the configured chain;
 * Pedalboard handles plugin delay compensation internally so the returned
 * audio is sample-aligned with the input — no leading silence, no tail loss.
 */
export class Vst3Stream<P extends Vst3Properties = Vst3Properties> extends BufferedTransformStream<P> {
	private streamContext?: StreamContext;
	private stagesJsonPath?: string;
	private stagesJsonCleanup?: () => Promise<void>;

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		this.streamContext = context;

		const { path, cleanup } = await writeStagesJson(this.properties.stages);

		this.stagesJsonPath = path;
		this.stagesJsonCleanup = cleanup;

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		if (!this.streamContext) throw new Error("Vst3Stream._process called before setup()");
		if (!this.stagesJsonPath) throw new Error("Vst3Stream._process called without a stages JSON file");

		const frames = buffer.frames;

		if (frames === 0) return;

		const channels = buffer.channels;
		const sampleRate = this.sampleRate ?? 44100;

		const chunk = await buffer.read(0, frames);
		const inputSamples = chunk.samples;

		const channelArrays: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			channelArrays.push(inputSamples[ch] ?? new Float32Array(frames));
		}

		const args: Array<string> = [
			...(this.properties.extraArgs ?? []),
			"--stages-json",
			this.stagesJsonPath,
			"--sample-rate",
			String(sampleRate),
			"--channels",
			String(channels),
		];

		const handle: VstHostHandle = spawnVstHost(this.properties.vstHostPath, args);

		try {
			await handle.ready;
		} catch (error) {
			handle.proc.kill();

			throw error;
		}

		const output = await processWholeFileThroughVstHost(handle, channelArrays, frames, channels);

		await buffer.truncate(0);
		await buffer.append(output);
	}

	override async _teardown(): Promise<void> {
		const cleanup = this.stagesJsonCleanup;

		this.stagesJsonPath = undefined;
		this.stagesJsonCleanup = undefined;

		if (cleanup) {
			try {
				await cleanup();
			} catch {
				// Temp-file cleanup is best-effort.
			}
		}
	}
}

export class Vst3Node<P extends Vst3Properties = Vst3Properties> extends TransformNode<P> {
	static override readonly moduleName: string = "VST3";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription: string = "Host a chain of VST3 effect plugins via Pedalboard (whole-file offline mode)";
	static override readonly schema: z.ZodType = schema;
	static override is(value: unknown): value is Vst3Node {
		return TransformNode.is(value) && value.type[2] === "vst3";
	}

	override readonly type: ReadonlyArray<string> = ["buffered-audio-node", "transform", "vst3"];

	constructor(properties: P) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
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
	stages: ReadonlyArray<VstStage>;
	bypass?: boolean;
	id?: string;
	extraArgs?: ReadonlyArray<string>;
}): Vst3Node {
	return new Vst3Node({
		vstHostPath: options.vstHostPath,
		stages: options.stages,
		bypass: options.bypass ?? false,
		id: options.id,
		extraArgs: options.extraArgs,
	});
}

export type { VstStage };
