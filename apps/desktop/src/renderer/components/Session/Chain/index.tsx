import { resnapshot } from "../../../models/ProxyStore/resnapshot";
import { Download, FileAudio } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { IdentifiedChain } from "../../../hooks/useChain";
import type { SessionContext } from "../../../models/Context";
import { useJobsState, waitForJobComplete } from "../../../models/State/Jobs";
import { Button } from "../../ui/button";
import { ChainManagerMenu } from "./ChainManager/ChainManagerMenu";
import { ChainSlots } from "./ChainSlots";
import { JobView } from "./JobView";

interface ChainPanelProps {
	readonly context: SessionContext;
}

function SignalFlowNode({ icon: Icon, label }: { icon: typeof FileAudio; label: string }) {
	return (
		<div className="flex items-center gap-2 border border-border bg-muted px-3 py-2">
			<Icon className="h-3.5 w-3.5 text-muted-foreground" />
			<span className="font-mono text-xs text-muted-foreground">{label}</span>
		</div>
	);
}

export const ChainPanel: React.FC<ChainPanelProps> = resnapshot(({ context }) => {
	const { chain, saveChain, sessionPath, queryClient, userDataPath, appStore, jobs } = context;
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
		(updater: (c: IdentifiedChain) => IdentifiedChain) => {
			saveChain(updater(chain));
		},
		[chain, saveChain],
	);

	const handleChainChange = useCallback(
		(updated: IdentifiedChain) => {
			saveChain(updated);
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
				if (transform.bypass) {
					completeModule(id, moduleIndex);
					continue;
				}

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
		<div className="flex h-full flex-col p-3">
			<div className="flex items-center justify-between pb-2">
				<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Chain</span>
				<ChainManagerMenu chain={chain} onChainChange={handleChainChange} userDataPath={userDataPath} />
			</div>
			<div className="relative flex flex-1 flex-col items-center overflow-y-auto">
				<div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 signal-line" />
				<div className="relative z-10 flex-shrink-0">
					<SignalFlowNode icon={FileAudio} label="Source" />
				</div>
				<div className="flex w-full flex-1 flex-col justify-center py-3">
					<ChainSlots context={context} chain={chain} setChain={setChain} />
				</div>
				<div className="relative z-10 flex-shrink-0">
					<SignalFlowNode icon={Download} label="Target" />
				</div>
			</div>
			<div className="flex justify-end pt-3">
				<Button
					disabled={transforms.length === 0}
					onClick={() => void handleApplyAll()}
				>
					Apply All
				</Button>
			</div>
		</div>
	);
});
