import fs from "node:fs/promises";
import path from "node:path";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { SAVE_SESSION_ACTION, type SaveSessionIpcParameters, type SaveSessionIpcReturn, type SaveSessionInput } from "./Renderer";

export class SaveSessionMainIpc extends AsyncMainIpc<SaveSessionIpcParameters, SaveSessionIpcReturn> {
	action = SAVE_SESSION_ACTION;

	async handler(input: SaveSessionInput, dependencies: IpcHandlerDependencies): Promise<SaveSessionIpcReturn> {
		const { logger } = dependencies;

		logger.info("Saving session", {
			namespace: "app",
			filePath: input.filePath,
		});

		await fs.mkdir(path.dirname(input.filePath), { recursive: true });
		await fs.writeFile(input.filePath, JSON.stringify(input.graphDefinition, null, 2));

		logger.info("Session saved", {
			namespace: "app",
			filePath: input.filePath,
		});

		return undefined;
	}
}
