import fs from "node:fs";
import archiver from "archiver";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { SAVE_SESSION_ACTION, type SaveSessionIpcParameters, type SaveSessionIpcReturn, type SaveSessionInput } from "./Renderer";

export class SaveSessionMainIpc extends AsyncMainIpc<SaveSessionIpcParameters, SaveSessionIpcReturn> {
	action = SAVE_SESSION_ACTION;

	async handler(input: SaveSessionInput, dependencies: IpcHandlerDependencies): Promise<SaveSessionIpcReturn> {
		const { logger } = dependencies;

		logger.info("Saving session", {
			namespace: "app",
			sessionPath: input.sessionPath,
			targetPath: input.targetPath,
		});

		const output = fs.createWriteStream(input.targetPath);
		const archive = archiver("zip", { store: true });

		const done = new Promise<void>((resolve, reject) => {
			output.on("close", resolve);
			output.on("error", reject);
			archive.on("error", reject);
		});

		archive.pipe(output);
		archive.directory(input.sessionPath, false);
		await archive.finalize();
		await done;

		logger.info("Session saved", {
			namespace: "app",
			targetPath: input.targetPath,
		});

		return undefined;
	}
}
