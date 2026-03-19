import { z } from "zod";
import { DeClickNode, type DeClickProperties } from ".";
import type { BufferedAudioNodeInput } from "../../node";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(20).describe("Max Click Duration"),
});

export interface DeCrackleProperties extends z.infer<typeof schema>, DeClickProperties {}

export class DeCrackleNode extends DeClickNode<DeCrackleProperties> {
	static override readonly moduleName: string = "De-Crackle";
	static override readonly schema = schema;

	static override is(value: unknown): value is DeCrackleNode {
		return DeClickNode.is(value) && value.type[3] === "de-crackle";
	}

	override readonly type = ["async-module", "transform", "de-click", "de-crackle"];

	constructor(properties: BufferedAudioNodeInput<DeCrackleProperties>) {
		super({ ...properties, ...schema.encode(properties) });
	}

	override clone(overrides?: Partial<DeCrackleProperties>): DeCrackleNode {
		return new DeCrackleNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deCrackle(options?: { sensitivity?: number; id?: string }): DeCrackleNode {
	const parsed = schema.parse(options ?? {});
	return new DeCrackleNode({ ...parsed, id: options?.id });
}
