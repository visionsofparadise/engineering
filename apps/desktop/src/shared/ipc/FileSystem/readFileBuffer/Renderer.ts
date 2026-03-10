import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ReadFileBufferIpcParameters = [filePath: string];
export type ReadFileBufferIpcReturn = Uint8Array;
export const READ_FILE_BUFFER_ACTION = "readFileBuffer" as const;

export class ReadFileBufferRendererIpc extends AsyncRendererIpc<typeof READ_FILE_BUFFER_ACTION, ReadFileBufferIpcParameters, ReadFileBufferIpcReturn> {
	action = READ_FILE_BUFFER_ACTION;
}
