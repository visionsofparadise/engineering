import fs from "node:fs/promises";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { READ_FILE_BUFFER_ACTION, type ReadFileBufferIpcParameters, type ReadFileBufferIpcReturn } from "./Renderer";

export class ReadFileBufferMainIpc extends AsyncMainIpc<ReadFileBufferIpcParameters, ReadFileBufferIpcReturn> {
	action = READ_FILE_BUFFER_ACTION;

	async handler(filePath: string, _dependencies: IpcHandlerDependencies): Promise<ReadFileBufferIpcReturn> {
		const buffer = await fs.readFile(filePath);
		return new Uint8Array(buffer);
	}
}
