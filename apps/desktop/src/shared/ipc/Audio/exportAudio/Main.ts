import { chain, read, write, type EncodingOptions, type ModuleEventMap, type SourceModule } from "@engineering/acm";
import { completeJob, startJob } from "../../../../main/audio/jobManager";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { EXPORT_AUDIO_ACTION, type ExportAudioInput, type ExportAudioIpcParameters, type ExportAudioIpcReturn } from "./Renderer";

// TODO: Refactor this as a generic module apply job
export class ExportAudioMainIpc extends AsyncMainIpc<ExportAudioIpcParameters, ExportAudioIpcReturn> {
	action = EXPORT_AUDIO_ACTION;

	async handler(input: ExportAudioInput, dependencies: IpcHandlerDependencies): Promise<ExportAudioIpcReturn> {
		const { browserWindow, logger } = dependencies;

		const { id: jobId, signal } = startJob();

		const encoding: EncodingOptions | undefined = input.format === "wav" ? undefined : { format: input.format, bitrate: input.bitrate, vbr: input.vbr };

		const source = chain(read(input.sourcePath), write(input.targetPath, { bitDepth: input.bitDepth, encoding })) as unknown as SourceModule;

		source.on("progress", (progressEvent: ModuleEventMap["progress"][0]) => {
			browserWindow.webContents.send("audio:progress", {
				jobId,
				moduleIndex: 0,
				moduleName: "export",
				...progressEvent,
			});
		});

		logger.info("Starting audio export", {
			namespace: "audio",
			sourcePath: input.sourcePath,
			targetPath: input.targetPath,
			format: input.format,
			jobId,
		});

		try {
			await source.render({ signal });

			completeJob(jobId);

			browserWindow.webContents.send("audio:chainComplete", {
				jobId,
				status: "completed",
				completedModules: 1,
				targetPath: input.targetPath,
			});

			logger.info("Audio export complete", {
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

				logger.info("Audio export aborted", {
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
