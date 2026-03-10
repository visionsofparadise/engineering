import type { ChainModuleReference } from "@engineering/acm";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface ApplyAllInput {
	readonly sessionPath: string;
	readonly sourcePath: string;
	readonly transforms: ReadonlyArray<ChainModuleReference>;
	readonly sourceOffset?: number;
	readonly sourceLength?: number;
	readonly sourceChannels?: ReadonlyArray<number>;
}

export type ApplyAllIpcParameters = [input: ApplyAllInput];
export type ApplyAllIpcReturn = string;
export const APPLY_ALL_ACTION = "audioApplyAll" as const;

export class ApplyAllRendererIpc extends AsyncRendererIpc<typeof APPLY_ALL_ACTION, ApplyAllIpcParameters, ApplyAllIpcReturn> {
	action = APPLY_ALL_ACTION;
}
