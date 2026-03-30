import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type CloseFileHandleIpcParameters = [handleId: string];
export type CloseFileHandleIpcReturn = undefined;
export const CLOSE_FILE_HANDLE_ACTION = "closeFileHandle" as const;

export class CloseFileHandleRendererIpc extends AsyncRendererIpc<typeof CLOSE_FILE_HANDLE_ACTION, CloseFileHandleIpcParameters, CloseFileHandleIpcReturn> {
	action = CLOSE_FILE_HANDLE_ACTION;
}
