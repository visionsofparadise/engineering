import { z } from "zod";
import { DeClickModule, type DeClickProperties } from ".";
import type { AudioChainModuleInput } from "../../module";

export const mouthDeClickSchema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.7).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(50).describe("Max Click Duration"),
});

export interface MouthDeClickProperties extends z.infer<typeof mouthDeClickSchema>, DeClickProperties {}

export class MouthDeClickModule extends DeClickModule<MouthDeClickProperties> {
	static override readonly moduleName: string = "Mouth De-Click";
	static override readonly schema = mouthDeClickSchema;
	static override is(value: unknown): value is MouthDeClickModule {
		return DeClickModule.is(value) && value.type[3] === "mouth-de-click";
	}

	override readonly type = ["async-module", "transform", "de-click", "mouth-de-click"];

	constructor(properties: AudioChainModuleInput<MouthDeClickProperties>) {
		super({ ...properties, ...mouthDeClickSchema.encode(properties) });
	}

	override clone(overrides?: Partial<MouthDeClickProperties>): MouthDeClickModule {
		return new MouthDeClickModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function mouthDeClick(options?: { sensitivity?: number; id?: string }): MouthDeClickModule {
	const parsed = mouthDeClickSchema.parse(options ?? {});
	return new MouthDeClickModule({ ...parsed, id: options?.id });
}
