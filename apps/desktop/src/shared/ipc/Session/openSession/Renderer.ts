import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface OpenSessionInput {
	readonly filePath: string;
}

export interface OpenSessionResult {
	readonly sessionId: string;
	readonly sessionPath: string;
	readonly label: string;
}

export type OpenSessionIpcParameters = [input: OpenSessionInput];
export type OpenSessionIpcReturn = OpenSessionResult;
export const OPEN_SESSION_ACTION = "sessionOpen" as const;

export class OpenSessionRendererIpc extends AsyncRendererIpc<typeof OPEN_SESSION_ACTION, OpenSessionIpcParameters, OpenSessionIpcReturn> {
	action = OPEN_SESSION_ACTION;
}
