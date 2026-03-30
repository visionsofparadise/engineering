import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { APPLY_ACTION, type ApplyInput, type ApplyIpcParameters, type ApplyIpcReturn } from "./Renderer";

export class ApplyMainIpc extends AsyncMainIpc<ApplyIpcParameters, ApplyIpcReturn> {
	action = APPLY_ACTION;

	handler(_input: ApplyInput, _dependencies: IpcHandlerDependencies): ApplyIpcReturn {
		throw new Error("apply not implemented — see plan 9");
	}
}
