import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { CLOSE_FILE_HANDLE_ACTION, type CloseFileHandleIpcParameters, type CloseFileHandleIpcReturn } from "./Renderer";

export class CloseFileHandleMainIpc extends AsyncMainIpc<CloseFileHandleIpcParameters, CloseFileHandleIpcReturn> {
	action = CLOSE_FILE_HANDLE_ACTION;

	async handler(handleId: string, dependencies: IpcHandlerDependencies): Promise<CloseFileHandleIpcReturn> {
		await dependencies.fileHandleManager.close(handleId);
	}
}
