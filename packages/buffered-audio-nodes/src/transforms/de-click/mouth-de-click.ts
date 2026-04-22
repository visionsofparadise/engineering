import { z } from "zod";
import { DeClickNode, DeClickStream, type DeClickProperties } from ".";
import type { BufferedAudioNodeInput } from "@e9g/buffered-audio-nodes-core";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";

/**
 * MouthDeClick is a preset subclass of DeClick tuned for mouth clicks on
 * close-mic vocal recordings. Mouth clicks concentrate in the 2–8 kHz range
 * (G&R §5.7 on tongue-click spectral content) and are common enough in vocal
 * material to warrant a higher click-density prior than the default.
 *
 * Only parameter defaults differ — the algorithm is the same faithful G&R
 * Ch 5–6 pipeline as `DeClick`.
 */
export const mouthDeClickSchema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.7).describe("Sensitivity"),
	frequencySkew: z.number().min(-1).max(1).multipleOf(0.01).default(0.3).describe("Frequency Skew"),
	clickWidening: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Click Widening"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(50).describe("Max Click Duration (ms)"),
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

	override createStream(): DeClickStream {
		return new DeClickStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
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
	id?: string;
}): MouthDeClickNode {
	return new MouthDeClickNode({ ...(options ?? {}), id: options?.id } as BufferedAudioNodeInput<MouthDeClickProperties>);
}
