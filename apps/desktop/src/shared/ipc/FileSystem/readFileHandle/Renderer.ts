import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ReadFileHandleIpcParameters = [handleId: string, offset: number, length: number];
export type ReadFileHandleIpcReturn = ArrayBuffer;
export const READ_FILE_HANDLE_ACTION = "readFileHandle" as const;

export class ReadFileHandleRendererIpc extends AsyncRendererIpc<typeof READ_FILE_HANDLE_ACTION, ReadFileHandleIpcParameters, ReadFileHandleIpcReturn> {
	action = READ_FILE_HANDLE_ACTION;
}
