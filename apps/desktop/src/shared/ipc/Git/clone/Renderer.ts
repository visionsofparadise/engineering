import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface GitCloneInput {
	readonly url: string;
	readonly directory: string;
}

export type GitCloneIpcParameters = [input: GitCloneInput];
export type GitCloneIpcReturn = undefined;
export const GIT_CLONE_ACTION = "gitClone" as const;

export class GitCloneRendererIpc extends AsyncRendererIpc<typeof GIT_CLONE_ACTION, GitCloneIpcParameters, GitCloneIpcReturn> {
	action = GIT_CLONE_ACTION;
}
