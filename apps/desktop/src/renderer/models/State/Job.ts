import type { IpcRendererEvent } from "electron";
import { useCallback, useEffect, useState } from "react";
import type { AudioChainCompleteEvent, AudioModuleCompleteEvent, AudioProgressEvent } from "../../../shared/utilities/emitToRenderer";

type ModuleJobStatus = "pending" | "running" | "completed" | "aborted";

export interface ModuleJobState {
	readonly moduleIndex: number;
	readonly moduleName: string;
	readonly status: ModuleJobStatus;
	readonly progress: number;
}

export interface JobState {
	readonly jobId: string;
	readonly modules: ReadonlyArray<ModuleJobState>;
	readonly status: "running" | "completed" | "aborted";
}

export function useJobState() {
	const [jobState, setJobState] = useState<JobState | undefined>(undefined);

	const handleProgress = useCallback((_event: IpcRendererEvent, data: AudioProgressEvent) => {
		setJobState((previous) => {
			if (previous?.jobId !== data.jobId) return previous;

			return {
				...previous,
				modules: previous.modules.map((mod) => {
					if (mod.moduleIndex !== data.moduleIndex) return mod;
					const progress = data.sourceTotalFrames ? data.framesProcessed / data.sourceTotalFrames : 0;
					return { ...mod, status: "running" as const, progress: Math.min(1, progress) };
				}),
			};
		});
	}, []);

	const handleModuleComplete = useCallback((_event: IpcRendererEvent, data: AudioModuleCompleteEvent) => {
		setJobState((previous) => {
			if (previous?.jobId !== data.jobId) return previous;

			return {
				...previous,
				modules: previous.modules.map((mod) =>
					mod.moduleIndex === data.moduleIndex ? { ...mod, status: "completed" as const, progress: 1 } : mod,
				),
			};
		});
	}, []);

	const handleChainComplete = useCallback((_event: IpcRendererEvent, data: AudioChainCompleteEvent) => {
		setJobState((previous) => {
			if (previous?.jobId !== data.jobId) return previous;

			if (data.status === "aborted") {
				return {
					...previous,
					status: "aborted",
					modules: previous.modules.map((mod) =>
						mod.status === "running" ? { ...mod, status: "aborted" as const } : mod,
					),
				};
			}

			return { ...previous, status: "completed" };
		});

		setTimeout(() => setJobState(undefined), 1000);
	}, []);

	useEffect(() => {
		window.main.events.on("audio:progress", handleProgress);
		window.main.events.on("audio:moduleComplete", handleModuleComplete);
		window.main.events.on("audio:chainComplete", handleChainComplete);

		return () => {
			window.main.events.removeListener("audio:progress", handleProgress);
			window.main.events.removeListener("audio:moduleComplete", handleModuleComplete);
			window.main.events.removeListener("audio:chainComplete", handleChainComplete);
		};
	}, [handleProgress, handleModuleComplete, handleChainComplete]);

	const startJob = useCallback((jobId: string, modules: ReadonlyArray<{ moduleName: string }>) => {
		setJobState({
			jobId,
			status: "running",
			modules: modules.map((mod, index) => ({
				moduleIndex: index,
				moduleName: mod.moduleName,
				status: "pending",
				progress: 0,
			})),
		});
	}, []);

	return { jobState, startJob };
}
