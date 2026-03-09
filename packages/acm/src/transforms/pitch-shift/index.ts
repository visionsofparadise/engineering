import { FfmpegModule, type FfmpegProperties } from "../../ffmpeg";
import type { AudioChainModuleInput, StreamContext } from "../../module";

export interface PitchShiftProperties extends FfmpegProperties {
	readonly semitones: number;
	readonly cents?: number;
}

export class PitchShiftModule extends FfmpegModule {
	static override is(value: unknown): value is PitchShiftModule {
		return FfmpegModule.is(value) && value.type[3] === "pitch-shift";
	}

	readonly type = ["async-module", "transform", "ffmpeg", "pitch-shift"] as const;
	readonly properties: PitchShiftProperties;

	constructor(properties: AudioChainModuleInput<PitchShiftProperties>) {
		super(properties);

		this.properties = { ...properties, targets: properties.targets ?? [] };
	}

	protected _buildArgs(_context: StreamContext): Array<string> {
		const { semitones, cents } = this.properties;
		const totalSemitones = semitones + (cents ?? 0) / 100;
		const pitchRatio = Math.pow(2, totalSemitones / 12);

		return ["-af", `rubberband=pitch=${pitchRatio}`];
	}

	clone(overrides?: Partial<PitchShiftProperties>): PitchShiftModule {
		return new PitchShiftModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function pitchShift(
	semitones: number,
	options?: {
		cents?: number;
		binaryPath?: string;
		id?: string;
	},
): PitchShiftModule {
	return new PitchShiftModule({
		semitones,
		cents: options?.cents,
		binaryPath: options?.binaryPath,
		id: options?.id,
	});
}
