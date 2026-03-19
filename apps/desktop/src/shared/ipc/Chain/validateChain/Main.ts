import { validateChainDefinition } from "buffered-audio-nodes";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { VALIDATE_CHAIN_ACTION, type ValidateChainIpcParameters, type ValidateChainIpcReturn } from "./Renderer";

export class ValidateChainMainIpc extends AsyncMainIpc<ValidateChainIpcParameters, ValidateChainIpcReturn> {
	action = VALIDATE_CHAIN_ACTION;

	handler(json: unknown, _dependencies: IpcHandlerDependencies): ValidateChainIpcReturn {
		return validateChainDefinition(json);
	}
}
