import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type OpenFileHandleIpcParameters = [filePath: string];
export type OpenFileHandleIpcReturn = string;
export const OPEN_FILE_HANDLE_ACTION = "openFileHandle" as const;

export class OpenFileHandleRendererIpc extends AsyncRendererIpc<typeof OPEN_FILE_HANDLE_ACTION, OpenFileHandleIpcParameters, OpenFileHandleIpcReturn> {
	action = OPEN_FILE_HANDLE_ACTION;
}
