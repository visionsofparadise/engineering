import fs from "node:fs/promises";
import type { SourceModule, ModuleEventMap } from "@engineering/acm";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { buildChain } from "../../../../main/audio/buildChain";
import { startJob, completeJob } from "../../../../main/audio/jobManager";
import { APPLY_CHAIN_ACTION, type ApplyChainIpcParameters, type ApplyChainIpcReturn, type ApplyChainInput } from "./Renderer";

export class ApplyChainMainIpc extends AsyncMainIpc<ApplyChainIpcParameters, ApplyChainIpcReturn> {
	action = APPLY_CHAIN_ACTION;

	async handler(input: ApplyChainInput, dependencies: IpcHandlerDependencies): Promise<ApplyChainIpcReturn> {
		const { browserWindow, logger } = dependencies;

		const { id: jobId, signal } = startJob();

		await fs.mkdir(input.targetPath, { recursive: true });

		const source = buildChain(input) as unknown as SourceModule;

		source.on("progress", (progressEvent: ModuleEventMap["progress"][0]) => {
			browserWindow.webContents.send("audio:progress", {
				jobId,
				moduleIndex: 0,
				moduleName: input.transforms[0]?.module ?? "",
				...progressEvent,
			});
		});

		logger.info("Starting chain execution", {
			namespace: "audio",
			sourcePath: input.sourcePath,
			targetPath: input.targetPath,
			jobId,
		});

		try {
			await source.render({ signal });

			completeJob(jobId);

			browserWindow.webContents.send("audio:chainComplete", {
				jobId,
				status: "completed",
				completedModules: input.transforms.length,
				targetPath: input.targetPath,
			});

			logger.info("Chain execution complete", {
				namespace: "audio",
				targetPath: input.targetPath,
				jobId,
			});
		} catch (error) {
			completeJob(jobId);

			if (signal.aborted) {
				browserWindow.webContents.send("audio:chainComplete", {
					jobId,
					status: "aborted",
					completedModules: 0,
				});

				logger.info("Chain execution aborted", {
					namespace: "audio",
					jobId,
				});
				return jobId;
			}

			throw error;
		}

		return jobId;
	}
}
