import { ReadNode, WriteNode, WaveformNode, SpectrogramNode, type EncodingOptions, type FrequencyScale, type SourceNode, type TransformNode } from "buffered-audio-nodes";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import type { ModuleRegistryMap } from "../../../models/ModuleRegistry";
import { APPLY_ACTION, type ApplyInput, type ApplyIpcParameters, type ApplyIpcReturn, type ChainModuleReference } from "./Renderer";

function resolveModule(ref: ChainModuleReference, registry: ModuleRegistryMap): TransformNode {
	const packageModules = registry.get(ref.package);

	if (!packageModules) throw new Error(`Unknown package: "${ref.package}"`);

	const Module = packageModules.get(ref.module);

	if (!Module) throw new Error(`Unknown module: "${ref.module}" in package "${ref.package}"`);

	const instance = new Module(ref.options);

	return instance as unknown as TransformNode;
}

function buildNodes(input: ApplyInput, registry: ModuleRegistryMap): SourceNode {
	const source = new ReadNode({ path: input.sourcePath, channels: input.sourceChannels ? [...input.sourceChannels] : undefined, ffmpegPath: "", ffprobePath: "" });

	const transforms = input.transforms.filter((ref) => !ref.bypass).map((ref) => resolveModule(ref, registry));

	if (input.waveform) {
		transforms.push(new WaveformNode({ outputPath: input.waveform.path, resolution: 500 }) as unknown as TransformNode);
	}

	if (input.spectrogram) {
		transforms.push(new SpectrogramNode({ outputPath: input.spectrogram.path, fftSize: 4096, hopSize: 4096, frequencyScale: (input.spectrogram.frequencyScale ?? "log") as FrequencyScale, fftwAddonPath: "" }) as unknown as TransformNode);
	}

	const encoding: EncodingOptions | undefined = input.encoding?.format === "wav" ? undefined : input.encoding;

	const target = new WriteNode({ path: input.targetPath, bitDepth: input.bitDepth ?? "16", encoding });

	let current: SourceNode | TransformNode = source;

	for (const transform of transforms) {
		current = current.to(transform);
	}

	current.to(target);

	return source;
}

export class ApplyMainIpc extends AsyncMainIpc<ApplyIpcParameters, ApplyIpcReturn> {
	action = APPLY_ACTION;

	async handler(input: ApplyInput, dependencies: IpcHandlerDependencies): Promise<ApplyIpcReturn> {
		const { browserWindow, jobManager, logger, moduleRegistry } = dependencies;

		const { id: jobId, signal } = jobManager.startJob();

		const source = buildNodes(input, moduleRegistry);

		logger.info("Starting apply", {
			namespace: "audio",
			sourcePath: input.sourcePath,
			targetPath: input.targetPath,
			jobId,
		});

		browserWindow.webContents.send("audio:progress", {
			jobId,
			moduleIndex: 0,
			moduleName: input.transforms[0]?.module ?? "apply",
			framesProcessed: 0,
			sourceTotalFrames: 0,
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
