import { z } from "zod";
import { DeClickNode, type DeClickProperties } from ".";
import type { BufferedAudioNodeInput } from "@e9g/buffered-audio-nodes-core";

export const mouthDeClickSchema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.7).describe("Sensitivity"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(50).describe("Max Click Duration"),
});

export interface MouthDeClickProperties extends z.infer<typeof mouthDeClickSchema>, DeClickProperties {}

export class MouthDeClickNode extends DeClickNode<MouthDeClickProperties> {
	static override readonly moduleName: string = "Mouth De-Click";
	static override readonly packageName = "buffered-audio-nodes";
	static override readonly schema = mouthDeClickSchema;
	static override is(value: unknown): value is MouthDeClickNode {
		return DeClickNode.is(value) && value.type[3] === "mouth-de-click";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-click", "mouth-de-click"];

	constructor(properties: BufferedAudioNodeInput<MouthDeClickProperties>) {
		super({ ...properties, ...mouthDeClickSchema.encode(properties) });
	}

	override clone(overrides?: Partial<MouthDeClickProperties>): MouthDeClickNode {
		return new MouthDeClickNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function mouthDeClick(options?: { sensitivity?: number; id?: string }): MouthDeClickNode {
	const parsed = mouthDeClickSchema.parse(options ?? {});

	return new MouthDeClickNode({ ...parsed, id: options?.id });
}
