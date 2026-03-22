import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { GIT_CLONE_ACTION, type GitCloneInput, type GitCloneIpcParameters, type GitCloneIpcReturn } from "./Renderer";

const execFileAsync = promisify(execFile);

export class GitCloneMainIpc extends AsyncMainIpc<GitCloneIpcParameters, GitCloneIpcReturn> {
	action = GIT_CLONE_ACTION;

	async handler(input: GitCloneInput, _dependencies: IpcHandlerDependencies): Promise<GitCloneIpcReturn> {
		await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", input.url, input.directory]);

		return undefined;
	}
}
