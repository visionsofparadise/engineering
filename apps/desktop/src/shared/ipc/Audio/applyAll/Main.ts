import fs from "node:fs/promises";
import path from "node:path";
import type { SourceModule, ModuleEventMap } from "@engineering/acm";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { buildChain } from "../../../../main/audio/buildChain";
import { startJob, completeJob } from "../../../../main/audio/jobManager";
import { APPLY_ALL_ACTION, type ApplyAllIpcParameters, type ApplyAllIpcReturn, type ApplyAllInput } from "./Renderer";

export class ApplyAllMainIpc extends AsyncMainIpc<ApplyAllIpcParameters, ApplyAllIpcReturn> {
	action = APPLY_ALL_ACTION;

	async handler(input: ApplyAllInput, dependencies: IpcHandlerDependencies): Promise<ApplyAllIpcReturn> {
		const { browserWindow, logger } = dependencies;

		const { id: jobId, signal } = startJob();

		logger.info("Starting apply all", {
			namespace: "audio",
			jobId,
			moduleCount: String(input.transforms.length),
		});

		let currentSourcePath = input.sourcePath;
		let completedModules = 0;

		try {
			for (let moduleIndex = 0; moduleIndex < input.transforms.length; moduleIndex++) {
				if (signal.aborted) break;

				const transform = input.transforms[moduleIndex];
				if (!transform) break;

				const timestamp = Date.now();
				const snapshotDir = path.join(input.sessionPath, `${timestamp}-${moduleIndex}-${transform.module}`);

				await fs.mkdir(snapshotDir, { recursive: true });

				const chainInput = {
					sourcePath: currentSourcePath,
					sourceChannels: moduleIndex === 0 ? input.sourceChannels : undefined,
					sourceOffset: moduleIndex === 0 ? input.sourceOffset : undefined,
					sourceLength: moduleIndex === 0 ? input.sourceLength : undefined,
					transforms: [transform],
					targetPath: snapshotDir,
				};

				const source = buildChain(chainInput) as unknown as SourceModule;

				source.on("progress", (progressEvent: ModuleEventMap["progress"][0]) => {
					browserWindow.webContents.send("audio:progress", {
						jobId,
						moduleIndex,
						moduleName: transform.module,
						...progressEvent,
					});
				});

				await source.render({ signal });

				browserWindow.webContents.send("audio:moduleComplete", {
					jobId,
					moduleIndex,
					moduleName: transform.module,
					snapshotPath: snapshotDir,
				});

				currentSourcePath = path.join(snapshotDir, "audio.wav");
				completedModules++;
			}

			completeJob(jobId);

			browserWindow.webContents.send("audio:chainComplete", {
				jobId,
				status: "completed",
				completedModules,
				targetPath: currentSourcePath,
			});

			logger.info("Apply all complete", {
				namespace: "audio",
				jobId,
				completedModules: String(completedModules),
			});
		} catch (error) {
			completeJob(jobId);

			if (signal.aborted) {
				browserWindow.webContents.send("audio:chainComplete", {
					jobId,
					status: "aborted",
					completedModules,
				});

				logger.info("Apply all aborted", {
					namespace: "audio",
					jobId,
					completedModules: String(completedModules),
				});

				return jobId;
			}

			throw error;
		}

		return jobId;
	}
}
