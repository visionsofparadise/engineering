import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { OPEN_FILE_HANDLE_ACTION, type OpenFileHandleIpcParameters, type OpenFileHandleIpcReturn } from "./Renderer";

export class OpenFileHandleMainIpc extends AsyncMainIpc<OpenFileHandleIpcParameters, OpenFileHandleIpcReturn> {
	action = OPEN_FILE_HANDLE_ACTION;

	async handler(filePath: string, dependencies: IpcHandlerDependencies): Promise<OpenFileHandleIpcReturn> {
		return dependencies.fileHandleManager.open(filePath);
	}
}
