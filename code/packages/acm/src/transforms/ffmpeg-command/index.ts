import { FfmpegModule, type FfmpegProperties } from "../../ffmpeg";
import type { AudioChainModuleInput, StreamContext } from "../../module";

export interface FfmpegCommandModuleProperties extends FfmpegProperties {
	readonly args: Array<string> | ((context: StreamContext) => Array<string>);
}

export class FfmpegCommandModule extends FfmpegModule {
	static override is(value: unknown): value is FfmpegCommandModule {
		return FfmpegModule.is(value) && value.type[3] === "ffmpeg";
	}

	readonly type = ["async-module", "transform", "ffmpeg", "ffmpeg"] as const;
	readonly properties: FfmpegCommandModuleProperties;

	constructor(properties: AudioChainModuleInput<FfmpegCommandModuleProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	protected _buildArgs(context: StreamContext): Array<string> {
		const { args } = this.properties;
		return typeof args === "function" ? args(context) : args;
	}

	clone(overrides?: Partial<FfmpegCommandModuleProperties>): FfmpegCommandModule {
		return new FfmpegCommandModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function ffmpeg(options: { args: Array<string> | ((context: StreamContext) => Array<string>); binaryPath?: string; id?: string }): FfmpegCommandModule {
	return new FfmpegCommandModule({
		args: options.args,
		binaryPath: options.binaryPath,
		id: options.id,
	});
}
