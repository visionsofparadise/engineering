import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { READ_FILE_HANDLE_ACTION, type ReadFileHandleIpcParameters, type ReadFileHandleIpcReturn } from "./Renderer";

export class ReadFileHandleMainIpc extends AsyncMainIpc<ReadFileHandleIpcParameters, ReadFileHandleIpcReturn> {
	action = READ_FILE_HANDLE_ACTION;

	async handler(handleId: string, offset: number, length: number, dependencies: IpcHandlerDependencies): Promise<ReadFileHandleIpcReturn> {
		return dependencies.fileHandleManager.read(handleId, offset, length);
	}
}
