import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import extractZip from "extract-zip";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { OPEN_SESSION_ACTION, type OpenSessionIpcParameters, type OpenSessionIpcReturn, type OpenSessionInput } from "./Renderer";

export class OpenSessionMainIpc extends AsyncMainIpc<OpenSessionIpcParameters, OpenSessionIpcReturn> {
	action = OPEN_SESSION_ACTION;

	async handler(input: OpenSessionInput, dependencies: IpcHandlerDependencies): Promise<OpenSessionIpcReturn> {
		const { logger } = dependencies;

		const sessionId = randomUUID();
		const sessionsDir = path.join(app.getPath("userData"), "sessions");
		const sessionPath = path.join(sessionsDir, sessionId);

		await fs.mkdir(sessionPath, { recursive: true });

		logger.info("Opening session from file", {
			namespace: "app",
			filePath: input.filePath,
			sessionPath,
		});

		await extractZip(input.filePath, { dir: sessionPath });

		const entries = await fs.readdir(sessionPath);
		const snapshots = entries.filter((entry) => entry !== "chain.json").sort();

		if (snapshots.length === 0) {
			await fs.rm(sessionPath, { recursive: true });
			throw new Error("Invalid session file: no snapshots found");
		}

		const label = path.basename(input.filePath, ".eng");

		logger.info("Session opened", {
			namespace: "app",
			sessionPath,
			snapshots: snapshots.length,
		});

		return { sessionId, sessionPath, label };
	}
}
