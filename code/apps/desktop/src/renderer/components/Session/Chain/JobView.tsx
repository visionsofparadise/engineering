import type { SessionContext } from "../../../models/Context";
import type { JobState } from "../../../models/State/Job";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
import { JobSlot } from "./JobSlot";

interface JobViewProps {
	readonly jobState: JobState;
	readonly onAbort: () => void;
	readonly context: SessionContext;
}

export const JobView: React.FC<JobViewProps> = ({ jobState, onAbort, context }) => (
	<div className="flex h-full flex-col">
		<div className="flex items-center justify-between border-b border-border px-3 py-2">
			<span className="text-xs font-medium text-muted-foreground">Chain</span>
		</div>
		<ScrollArea className="flex-1">
			<div className="flex flex-col gap-1 p-2">
				{jobState.modules.map((moduleJob) => (
					<JobSlot key={moduleJob.moduleIndex} moduleJob={moduleJob} index={moduleJob.moduleIndex} context={context} />
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
