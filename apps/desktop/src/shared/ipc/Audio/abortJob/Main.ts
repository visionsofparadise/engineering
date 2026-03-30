import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { ABORT_JOB_ACTION, type AbortJobIpcParameters, type AbortJobIpcReturn } from "./Renderer";

export class AbortJobMainIpc extends AsyncMainIpc<AbortJobIpcParameters, AbortJobIpcReturn> {
	action = ABORT_JOB_ACTION;

	handler(_jobId: string, _dependencies: IpcHandlerDependencies): AbortJobIpcReturn {
		throw new Error("abortJob not implemented — see plan 9");
	}
}
