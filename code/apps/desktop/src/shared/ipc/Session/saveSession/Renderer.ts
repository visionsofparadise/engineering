import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface SaveSessionInput {
	readonly sessionPath: string;
	readonly targetPath: string;
}

export type SaveSessionIpcParameters = [input: SaveSessionInput];
export type SaveSessionIpcReturn = undefined;
export const SAVE_SESSION_ACTION = "sessionSave" as const;

export class SaveSessionRendererIpc extends AsyncRendererIpc<typeof SAVE_SESSION_ACTION, SaveSessionIpcParameters, SaveSessionIpcReturn> {
	action = SAVE_SESSION_ACTION;
}
