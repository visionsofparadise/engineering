import { z } from "zod";
import { DeClickNode, type DeClickProperties } from ".";
import type { BufferedAudioNodeInput } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";

/**
 * MouthDeClick is a preset subclass of DeClick tuned for mouth clicks on
 * close-mic vocal recordings. Per design-declick's "mouthDeClick preset"
 * section: `frequencySkew = 0.3` biases the adaptive threshold toward the
 * high-frequency bins where mouth-click TF energy lives.
 * `clickWidening = 0.3` is a modest TF-cell dilation on the BMRI binary
 * mask to catch pre/post-echo of the click's TF footprint.
 * `maxClickDuration = 50` ms is a safety ceiling. `sensitivity = 0.5`
 * maps to γ ≈ 6.25% in Ruhland's matched-setting region for
 * supergaussian/Cauchy-shaped impulses.
 *
 * `minFrequency = 4000`, `maxFrequency = undefined` (no upper cap) apply
 * attenuation above 4 kHz while preserving speech harmonics below, per
 * Dolby International AB patent EP4196978B1 "Automatic detection and
 * attenuation of speech-articulation noise events" (priority 2020-08-12,
 * granted 2024-12-11), which prescribes: "a further constraint could be
 * optionally applied for speech clicks, to allow high frequency
 * attenuation only (above 4 kHz, for example) in order to avoid
 * unintentionally modifying speech harmonics." Bins below 4 kHz are
 * force-kept in the target path so voiced-speech harmonics pass through
 * bit-for-bit. See design-declick decision log 2026-04-24 band-restriction
 * entry.
 *
 * Only parameter defaults differ — the algorithm is the same BMRI
 * pipeline as `DeClick`.
 */
export const mouthDeClickSchema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	frequencySkew: z.number().min(-1).max(1).multipleOf(0.01).default(0.3).describe("Frequency Skew"),
	clickWidening: z.number().min(0).max(1).multipleOf(0.01).default(0.3).describe("Click Widening"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(50).describe("Max Click Duration (ms)"),
	minFrequency: z.number().min(0).default(4000).describe("Min Frequency (Hz)"),
	maxFrequency: z.number().positive().optional().describe("Max Frequency (Hz)"),
});

export interface MouthDeClickProperties extends Omit<DeClickProperties, keyof z.infer<typeof mouthDeClickSchema>>, z.infer<typeof mouthDeClickSchema> {}

export class MouthDeClickNode extends DeClickNode<MouthDeClickProperties> {
	static override readonly moduleName: string = "Mouth De-Click";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly schema = mouthDeClickSchema;
	static override is(value: unknown): value is MouthDeClickNode {
		return DeClickNode.is(value) && value.type[3] === "mouth-de-click";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-click", "mouth-de-click"];

	constructor(properties?: BufferedAudioNodeInput<MouthDeClickProperties>) {
		const parsed = mouthDeClickSchema.parse(properties ?? {});

		super({ ...properties, ...parsed } as BufferedAudioNodeInput<MouthDeClickProperties>);
	}

	override clone(overrides?: Partial<MouthDeClickProperties>): MouthDeClickNode {
		return new MouthDeClickNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function mouthDeClick(options?: {
	sensitivity?: number;
	frequencySkew?: number;
	clickWidening?: number;
	maxClickDuration?: number;
	minFrequency?: number;
	maxFrequency?: number;
	id?: string;
}): MouthDeClickNode {
	return new MouthDeClickNode({ ...(options ?? {}), id: options?.id } as BufferedAudioNodeInput<MouthDeClickProperties>);
}
