import type { ChainDefinition } from "@engineering/acm";
import { useCallback, useEffect, useRef } from "react";
import { useSaveChain } from "../../../hooks/useChain";
import type { SessionContext } from "../../../models/Context";
import { useJobsState, waitForJobComplete } from "../../../models/State/Jobs";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import { ChainManagerMenu } from "./ChainManager/ChainManagerMenu";
import { ChainSlots } from "./ChainSlots";
import { JobView } from "./JobView";

interface ChainPanelProps {
	readonly context: SessionContext;
}

export const ChainPanel: React.FC<ChainPanelProps> = ({ context }) => {
	const { chain, sessionPath, queryClient, userDataPath, appStore, jobs } = context;
	const saveChain = useSaveChain(sessionPath);
	const { startJob, updateModuleProgress, completeModule, completeChain } = useJobsState(appStore, jobs);
	const activeJobIdRef = useRef<string | undefined>(undefined);

	const chainJobId = useRef<string | undefined>(undefined);

	const jobState = chainJobId.current ? jobs.jobs.get(chainJobId.current) : undefined;

	useEffect(() => {
		if (jobState?.status === "completed" || jobState?.status === "aborted") {
			void queryClient.invalidateQueries({ queryKey: ["snapshots", sessionPath] });
		}
	}, [jobState?.status, queryClient, sessionPath]);

	const transforms = chain.transforms;

	const setChain = useCallback(
		(updater: (c: ChainDefinition) => ChainDefinition) => {
			saveChain.mutate(updater(chain));
		},
		[chain, saveChain],
	);

	const handleChainChange = useCallback(
		(updated: ChainDefinition) => {
			saveChain.mutate(updated);
		},
		[saveChain],
	);

	const handleAbort = useCallback(() => {
		const jobId = activeJobIdRef.current;
		if (jobId) {
			void window.main.audioAbortJob(jobId);
		}
	}, []);

	const handleApplyAll = useCallback(async () => {
		if (transforms.length === 0) return;

		const snapshotPaths = await window.main.readDirectory(sessionPath);
		const latestSnapshot = snapshotPaths.filter((entry) => entry !== "chain.json").sort().pop();
		if (!latestSnapshot) return;

		let currentSource = `${sessionPath}/${latestSnapshot}/audio.wav`;

		const id = crypto.randomUUID();
		chainJobId.current = id;
		startJob(id, transforms.map((transform) => ({ moduleName: transform.module })));

		try {
			for (let moduleIndex = 0; moduleIndex < transforms.length; moduleIndex++) {
				const transform = transforms[moduleIndex];
				if (!transform) break;

				const timestamp = Date.now();
				const snapshotDir = `${sessionPath}/${timestamp}-${moduleIndex}-${transform.module}`;
				await window.main.ensureDirectory(snapshotDir);

				const jobId = await window.main.audioApply({
					sourcePath: currentSource,
					targetPath: `${snapshotDir}/audio.wav`,
					transforms: [transform],
					waveform: { path: `${snapshotDir}/waveform.bin` },
					spectrogram: { path: `${snapshotDir}/spectrogram.bin`, frequencyScale: "log" },
				});

				activeJobIdRef.current = jobId;
				updateModuleProgress(id, moduleIndex, jobId);

				await waitForJobComplete(jobId);

				completeModule(id, moduleIndex);
				currentSource = `${snapshotDir}/audio.wav`;
			}

			completeChain(id, "completed");
		} catch {
			completeChain(id, "aborted");
		}

		activeJobIdRef.current = undefined;
	}, [transforms, sessionPath, startJob, updateModuleProgress, completeModule, completeChain]);

	if (jobState?.status === "running") {
		return <JobView context={context} jobState={jobState} onAbort={handleAbort} chain={chain} setChain={setChain} />;
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground">Chain</span>
				<ChainManagerMenu chain={chain} onChainChange={handleChainChange} userDataPath={userDataPath} />
			</div>
			<ScrollArea className="flex-1">
				<ChainSlots context={context} chain={chain} setChain={setChain} />
			</ScrollArea>
			<div className="flex justify-end border-t border-border px-3 py-2">
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs"
					disabled={transforms.length === 0}
					onClick={() => void handleApplyAll()}
				>
					Apply All
				</Button>
			</div>
		</div>
	);
};
