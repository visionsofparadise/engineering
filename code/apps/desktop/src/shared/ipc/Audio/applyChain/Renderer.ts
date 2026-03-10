import type { ChainModuleReference } from "@engineering/acm";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface ApplyChainInput {
	readonly sourcePath: string;
	readonly sourceChannels?: ReadonlyArray<number>;
	readonly sourceOffset?: number;
	readonly sourceLength?: number;
	readonly transforms: ReadonlyArray<ChainModuleReference>;
	readonly targetPath: string;
}

export type ApplyChainIpcParameters = [input: ApplyChainInput];
export type ApplyChainIpcReturn = string;
export const APPLY_CHAIN_ACTION = "audioApplyChain" as const;

export class ApplyChainRendererIpc extends AsyncRendererIpc<typeof APPLY_CHAIN_ACTION, ApplyChainIpcParameters, ApplyChainIpcReturn> {
	action = APPLY_CHAIN_ACTION;
}
