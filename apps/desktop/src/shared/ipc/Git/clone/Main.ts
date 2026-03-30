import fs from "node:fs";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { GIT_CLONE_ACTION, type GitCloneInput, type GitCloneIpcParameters, type GitCloneIpcReturn } from "./Renderer";

export class GitCloneMainIpc extends AsyncMainIpc<GitCloneIpcParameters, GitCloneIpcReturn> {
	action = GIT_CLONE_ACTION;

	async handler(input: GitCloneInput, _dependencies: IpcHandlerDependencies): Promise<GitCloneIpcReturn> {
		await git.clone({
			fs,
			http,
			dir: input.directory,
			url: input.url,
			depth: 1,
			singleBranch: true,
		});

		return undefined;
	}
}
