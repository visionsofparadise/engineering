import type { ChainModuleReference } from "@engineering/acm";
import { useCallback, useEffect } from "react";
import { useSaveChain } from "../../../hooks/useChain";
import type { SessionContext } from "../../../models/Context";
import { useJobState } from "../../../models/State/Job";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import { ChainSlots } from "./ChainSlots";
import { JobView } from "./JobView";
import { ModuleMenu } from "./ModuleMenu";

interface ChainPanelProps {
	readonly context: SessionContext;
}

export const ChainPanel: React.FC<ChainPanelProps> = ({ context }) => {
	const { chain, sessionPath, queryClient } = context;
	const saveChain = useSaveChain(sessionPath);
	const { jobState, startJob } = useJobState();

	useEffect(() => {
		if (jobState?.status === "completed" || jobState?.status === "aborted") {
			void queryClient.invalidateQueries({ queryKey: ["snapshots", sessionPath] });
		}
	}, [jobState?.status, queryClient, sessionPath]);

	const transforms = chain.transforms;

	const handleAdd = useCallback(
		(moduleName: string) => {
			const newTransform: ChainModuleReference = { package: "acm", module: moduleName };
			saveChain.mutate({ ...chain, transforms: [...transforms, newTransform] });
		},
		[chain, transforms, saveChain],
	);

	const handleAbort = useCallback(() => {
		if (jobState) {
			void window.main.audioAbortJob(jobState.jobId);
		}
	}, [jobState]);

	const handleApplyAll = useCallback(async () => {
		if (transforms.length === 0) return;

		const snapshotPaths = await window.main.readDirectory(sessionPath);
		const latestSnapshot = snapshotPaths.filter((entry) => entry !== "chain.json").sort().pop();
		if (!latestSnapshot) return;

		const sourcePath = `${sessionPath}/${latestSnapshot}/audio.wav`;

		const jobId = await window.main.audioApplyAll({
			sessionPath,
			sourcePath,
			transforms,
		});

		startJob(jobId, transforms.map((transform) => ({ moduleName: transform.module })));
	}, [transforms, sessionPath, startJob]);

	if (jobState?.status === "running") {
		return <JobView jobState={jobState} onAbort={handleAbort} context={context} />;
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground">Chain</span>
				<ModuleMenu onSelect={handleAdd} />
			</div>
			<ScrollArea className="flex-1">
				<ChainSlots context={context} />
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
