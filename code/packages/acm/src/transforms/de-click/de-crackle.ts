import { z } from "zod";
import { DeClickModule, type DeClickProperties } from ".";
import type { AudioChainModuleInput } from "../../module";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(20).describe("Max Click Duration"),
});

export interface DeCrackleProperties extends z.infer<typeof schema>, DeClickProperties {}

export class DeCrackleModule extends DeClickModule<DeCrackleProperties> {
	static override readonly moduleName: string = "De-Crackle";
	static override readonly schema = schema;

	static override is(value: unknown): value is DeCrackleModule {
		return DeClickModule.is(value) && value.type[3] === "de-crackle";
	}

	override readonly type = ["async-module", "transform", "de-click", "de-crackle"];

	constructor(properties: AudioChainModuleInput<DeCrackleProperties>) {
		super({ ...properties, ...schema.encode(properties) });
	}

	override clone(overrides?: Partial<DeCrackleProperties>): DeCrackleModule {
		return new DeCrackleModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deCrackle(options?: { sensitivity?: number; id?: string }): DeCrackleModule {
	const parsed = schema.parse(options ?? {});
	return new DeCrackleModule({ ...parsed, id: options?.id });
}
