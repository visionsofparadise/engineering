import { FfmpegModule, type FfmpegProperties } from "../../ffmpeg";
import type { AudioChainModuleInput, StreamContext } from "../../module";

export interface TimeStretchProperties extends FfmpegProperties {
	readonly rate: number;
}

export class TimeStretchModule extends FfmpegModule {
	static override is(value: unknown): value is TimeStretchModule {
		return FfmpegModule.is(value) && value.type[3] === "time-stretch";
	}

	readonly type = ["async-module", "transform", "ffmpeg", "time-stretch"] as const;
	readonly properties: TimeStretchProperties;

	constructor(properties: AudioChainModuleInput<TimeStretchProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	protected _buildArgs(_context: StreamContext): Array<string> {
		const filters = buildAtempoChain(this.properties.rate);
		return ["-af", filters.join(",")];
	}

	clone(overrides?: Partial<TimeStretchProperties>): TimeStretchModule {
		return new TimeStretchModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

function buildAtempoChain(rate: number): Array<string> {
	const filters: Array<string> = [];
	let remaining = rate;

	while (remaining > 2.0) {
		filters.push("atempo=2.0");
		remaining /= 2.0;
	}

	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}

	filters.push(`atempo=${remaining}`);

	return filters;
}

export function timeStretch(
	rate: number,
	options?: {
		binaryPath?: string;
		id?: string;
	},
): TimeStretchModule {
	return new TimeStretchModule({
		rate,
		binaryPath: options?.binaryPath,
		id: options?.id,
	});
}
