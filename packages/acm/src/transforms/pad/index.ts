import type { ChunkBuffer } from "../../chunk-buffer";
import type { AudioChainModuleInput, StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export interface PadProperties extends TransformModuleProperties {
	readonly before?: number;
	readonly after?: number;
}

export class PadModule extends TransformModule {
	static override is(value: unknown): value is PadModule {
		return TransformModule.is(value) && value.type[2] === "pad";
	}

	readonly type = ["async-module", "transform", "pad"] as const;
	readonly properties: PadProperties;
	readonly bufferSize = Infinity;
	readonly latency = Infinity;

	private padSampleRate = 44100;
	private padChannels = 1;

	constructor(properties: AudioChainModuleInput<PadProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.padSampleRate = context.sampleRate;
		this.padChannels = context.channels;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const { before, after } = this.properties;
		const channels = this.padChannels;

		if (before !== undefined && before > 0) {
			const silenceFrames = Math.round(before * this.padSampleRate);
			const frames = buffer.frames;
			const allAudio = await buffer.read(0, frames);

			const padded: Array<Float32Array> = [];

			for (let ch = 0; ch < channels; ch++) {
				const original = allAudio.samples[ch] ?? new Float32Array(0);
				const withPad = new Float32Array(silenceFrames + original.length);
				withPad.set(original, silenceFrames);
				padded.push(withPad);
			}

			await buffer.truncate(0);
			await buffer.append(padded);
		}

		if (after !== undefined && after > 0) {
			const silenceFrames = Math.round(after * this.padSampleRate);
			const silence: Array<Float32Array> = [];

			for (let ch = 0; ch < channels; ch++) {
				silence.push(new Float32Array(silenceFrames));
			}

			await buffer.append(silence);
		}
	}

	clone(overrides?: Partial<PadProperties>): PadModule {
		return new PadModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function pad(options: { before?: number; after?: number; id?: string }): PadModule {
	return new PadModule({
		before: options.before,
		after: options.after,
		id: options.id,
	});
}
