import { z } from "zod";
import type { StreamContext } from "../../module";
import { FfmpegModule, type FfmpegProperties } from "../ffmpeg";

export const schema = z.object({
	semitones: z.number().min(-24).max(24).multipleOf(1).default(0).describe("Semitones"),
	cents: z.number().min(-100).max(100).multipleOf(1).default(0).describe("Cents"),
});

export interface PitchShiftProperties extends FfmpegProperties {
	readonly semitones: number;
	readonly cents?: number;
}

export class PitchShiftModule extends FfmpegModule<PitchShiftProperties> {
	static override readonly moduleName = "Pitch Shift";
	static override readonly schema = schema;
	static override is(value: unknown): value is PitchShiftModule {
		return FfmpegModule.is(value) && value.type[3] === "pitch-shift";
	}

	override readonly type = ["async-module", "transform", "ffmpeg", "pitch-shift"] as const;

	protected override _buildArgs(_context: StreamContext): Array<string> {
		const { semitones, cents } = this.properties;
		const totalSemitones = semitones + (cents ?? 0) / 100;
		const pitchRatio = Math.pow(2, totalSemitones / 12);

		return ["-af", `rubberband=pitch=${pitchRatio}`];
	}

	override clone(overrides?: Partial<PitchShiftProperties>): PitchShiftModule {
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
