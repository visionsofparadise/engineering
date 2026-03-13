import type { ModuleEventMap, SourceModule } from "audio-chain-module";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { APPLY_ACTION, type ApplyInput, type ApplyIpcParameters, type ApplyIpcReturn } from "./Renderer";
import { buildChain } from "./utils/buildChain";

export class ApplyMainIpc extends AsyncMainIpc<ApplyIpcParameters, ApplyIpcReturn> {
	action = APPLY_ACTION;

	async handler(input: ApplyInput, dependencies: IpcHandlerDependencies): Promise<ApplyIpcReturn> {
		const { browserWindow, jobManager, logger, moduleRegistry } = dependencies;

		const { id: jobId, signal } = jobManager.startJob();

		const source = buildChain(input, moduleRegistry) as unknown as SourceModule;

		source.on("progress", (progressEvent: ModuleEventMap["progress"][0]) => {
			browserWindow.webContents.send("audio:progress", {
				jobId,
				moduleIndex: 0,
				moduleName: input.transforms[0]?.module ?? "apply",
				...progressEvent,
			});
		});

		logger.info("Starting apply", {
			namespace: "audio",
			sourcePath: input.sourcePath,
			targetPath: input.targetPath,
			jobId,
		});

		try {
			await source.render({ signal });

			jobManager.completeJob(jobId);

			browserWindow.webContents.send("audio:chainComplete", {
				jobId,
				status: "completed",
				completedModules: input.transforms.length,
				targetPath: input.targetPath,
			});

			logger.info("Apply complete", {
				namespace: "audio",
				targetPath: input.targetPath,
				jobId,
			});
		} catch (error) {
			jobManager.completeJob(jobId);

			if (signal.aborted) {
				browserWindow.webContents.send("audio:chainComplete", {
					jobId,
					status: "aborted",
					completedModules: 0,
				});

				logger.info("Apply aborted", {
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
