import type { IpcRendererEvent } from "electron";
import { useCallback, useEffect, useRef } from "react";
import type { AudioChainCompleteEvent, AudioProgressEvent } from "../../../shared/utilities/emitToRenderer";
import type { ProxyStore } from "../ProxyStore/ProxyStore";
import type { State } from ".";

type ModuleJobStatus = "pending" | "running" | "completed" | "aborted";

export interface ModuleJobState {
	readonly moduleIndex: number;
	readonly moduleName: string;
	readonly status: ModuleJobStatus;
	readonly progress: number;
	readonly activeJobId?: string;
}

export interface JobState {
	readonly jobId: string;
	readonly modules: ReadonlyArray<ModuleJobState>;
	readonly status: "running" | "completed" | "aborted";
}

export interface JobsState extends State {
	readonly jobs: ReadonlyMap<string, JobState>;
}

export function useJobsState(store: ProxyStore, jobs: JobsState) {
	const activeJobIdsRef = useRef(new Set<string>());

	const handleProgress = useCallback(
		(_event: IpcRendererEvent, data: AudioProgressEvent) => {
			if (!activeJobIdsRef.current.has(data.jobId)) return;

			store.mutate(jobs, (proxy) => {
				for (const [, job] of proxy.jobs) {
					if (job.status !== "running") continue;

					for (const mod of job.modules) {
						if (mod.activeJobId !== data.jobId) continue;
						const progress = data.sourceTotalFrames ? data.framesProcessed / data.sourceTotalFrames : 0;

						mod.status = "running";
						mod.progress = Math.min(1, progress);

						return;
					}
				}
			});
		},
		[store, jobs],
	);

	const handleChainComplete = useCallback(
		(_event: IpcRendererEvent, data: AudioChainCompleteEvent) => {
			activeJobIdsRef.current.delete(data.jobId);
		},
		[],
	);

	useEffect(() => {
		window.main.events.on("audio:progress", handleProgress);
		window.main.events.on("audio:chainComplete", handleChainComplete);

		return () => {
			window.main.events.removeListener("audio:progress", handleProgress);
			window.main.events.removeListener("audio:chainComplete", handleChainComplete);
		};
	}, [handleProgress, handleChainComplete]);

	const startJob = useCallback(
		(jobId: string, modules: ReadonlyArray<{ moduleName: string }>) => {
			store.mutate(jobs, (proxy) => {
				proxy.jobs.set(jobId, {
					jobId,
					status: "running",
					modules: modules.map((mod, index) => ({
						moduleIndex: index,
						moduleName: mod.moduleName,
						status: "pending",
						progress: 0,
					})),
				});
			});
		},
		[store, jobs],
	);

	const updateModuleProgress = useCallback(
		(chainJobId: string, moduleIndex: number, activeJobId: string) => {
			activeJobIdsRef.current.add(activeJobId);

			store.mutate(jobs, (proxy) => {
				const job = proxy.jobs.get(chainJobId);

				if (!job) return;

				const mod = job.modules[moduleIndex];

				if (!mod) return;

				mod.status = "running";
				mod.activeJobId = activeJobId;
			});
		},
		[store, jobs],
	);

	const completeModule = useCallback(
		(chainJobId: string, moduleIndex: number) => {
			store.mutate(jobs, (proxy) => {
				const job = proxy.jobs.get(chainJobId);

				if (!job) return;

				const mod = job.modules[moduleIndex];

				if (!mod) return;

				mod.status = "completed";
				mod.progress = 1;
			});
		},
		[store, jobs],
	);

	const completeChain = useCallback(
		(chainJobId: string, status: "completed" | "aborted") => {
			store.mutate(jobs, (proxy) => {
				const job = proxy.jobs.get(chainJobId);

				if (!job) return;

				job.status = status;

				if (status === "aborted") {
					for (const mod of job.modules) {
						if (mod.status === "running" || mod.status === "pending") {
							mod.status = "aborted";
						}
					}
				}
			});

			setTimeout(() => {
				store.mutate(jobs, (proxy) => {
					proxy.jobs.delete(chainJobId);
				});
			}, 1000);
		},
		[store, jobs],
	);

	return { startJob, updateModuleProgress, completeModule, completeChain };
}

export function waitForJobComplete(jobId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const handleComplete = (_event: IpcRendererEvent, data: AudioChainCompleteEvent) => {
			if (data.jobId !== jobId) return;

			window.main.events.removeListener("audio:chainComplete", handleComplete);

			if (data.status === "aborted") {
				reject(new Error("Job aborted"));
			} else {
				resolve();
			}
		};

		window.main.events.on("audio:chainComplete", handleComplete);
	});
}
