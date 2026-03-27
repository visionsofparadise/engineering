import type { IdentifiedChain } from "../../../models/Chain";
import type { AppContext } from "../../../models/Context";
import type { JobState } from "../../../models/State/Jobs";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import { JobSlot } from "./JobSlot";

interface JobViewProps {
	readonly context: AppContext;
	readonly jobState: JobState;
	readonly onAbort: () => void;
	readonly chain: IdentifiedChain;
	readonly setChain: (updater: (chain: IdentifiedChain) => IdentifiedChain) => void;
}

export const JobView: React.FC<JobViewProps> = ({ context, jobState, onAbort, chain, setChain }) => (
	<div className="flex h-full flex-col">
		<div className="flex items-center justify-between border-b border-border px-3 py-2">
			<span className="text-xs font-medium text-muted-foreground">Chain</span>
		</div>
		<ScrollArea className="flex-1">
			<div className="flex flex-col gap-1 p-2">
				{jobState.modules.map((moduleJob) => (
					<JobSlot
						key={moduleJob.moduleIndex}
						packageName={chain.transforms[moduleJob.moduleIndex]?.packageName ?? "acm"}
						moduleJob={moduleJob}
						index={moduleJob.moduleIndex}
						context={context}
						chain={chain}
						setChain={setChain}
					/>
				))}
			</div>
		</ScrollArea>
		<div className="flex justify-end border-t border-border px-3 py-2">
			<Button
				variant="destructive"
				size="sm"
				className="h-7 text-xs"
				onClick={onAbort}
				disabled={jobState.status !== "running"}
			>
				Abort
			</Button>
		</div>
	</div>
);
