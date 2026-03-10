import fs from "node:fs/promises";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { STAT_ACTION, type StatIpcParameters, type StatIpcReturn } from "./Renderer";

export class StatMainIpc extends AsyncMainIpc<StatIpcParameters, StatIpcReturn> {
	action = STAT_ACTION;

	async handler(filePath: string, _dependencies: IpcHandlerDependencies): Promise<StatIpcReturn> {
		try {
			const stats = await fs.stat(filePath);
			return {
				size: stats.size,
				modifiedAt: stats.mtimeMs,
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return null;
			}
			throw error;
		}
	}
}
