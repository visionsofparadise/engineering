import fs from "node:fs/promises";
import { validateGraphDefinition } from "buffered-audio-nodes-core";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { OPEN_SESSION_ACTION, type OpenSessionIpcParameters, type OpenSessionIpcReturn, type OpenSessionInput } from "./Renderer";

export class OpenSessionMainIpc extends AsyncMainIpc<OpenSessionIpcParameters, OpenSessionIpcReturn> {
	action = OPEN_SESSION_ACTION;

	async handler(input: OpenSessionInput, dependencies: IpcHandlerDependencies): Promise<OpenSessionIpcReturn> {
		const { logger } = dependencies;

		logger.info("Opening session from file", {
			namespace: "app",
			filePath: input.filePath,
		});

		const raw = await fs.readFile(input.filePath, "utf-8");
		const json = JSON.parse(raw);
		const graphDefinition = validateGraphDefinition(json);
		const label = graphDefinition.name || "Untitled";

		logger.info("Session opened", {
			namespace: "app",
			filePath: input.filePath,
			label,
		});

		return { graphDefinition, label };
	}
}
