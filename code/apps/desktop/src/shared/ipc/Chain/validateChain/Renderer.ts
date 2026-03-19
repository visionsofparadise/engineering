import type { ChainDefinition } from "buffered-audio-nodes";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ValidateChainIpcParameters = [json: unknown];
export type ValidateChainIpcReturn = ChainDefinition;
export const VALIDATE_CHAIN_ACTION = "validateChain" as const;

export class ValidateChainRendererIpc extends AsyncRendererIpc<typeof VALIDATE_CHAIN_ACTION, ValidateChainIpcParameters, ValidateChainIpcReturn> {
	action = VALIDATE_CHAIN_ACTION;
}
