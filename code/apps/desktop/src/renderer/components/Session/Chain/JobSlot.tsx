import type { IdentifiedChain } from "../../../models/Chain";
import { Check, Loader2 } from "lucide-react";
import type { AppContext } from "../../../models/Context";
import type { ModuleJobState } from "../../../models/State/Jobs";
import { cn } from "../../../utils/cn";
import { Parameters } from "./Parameters/Parameters";

interface JobSlotProps {
	readonly packageName: string;
	readonly moduleJob: ModuleJobState;
	readonly index: number;
	readonly context: AppContext;
	readonly chain: IdentifiedChain;
	readonly setChain: (updater: (chain: IdentifiedChain) => IdentifiedChain) => void;
}

export const JobSlot: React.FC<JobSlotProps> = ({ packageName, moduleJob, index, context, chain, setChain }) => (
	<Parameters packageName={packageName} module={moduleJob.moduleName} index={index} context={context} chain={chain} setChain={setChain} disabled>
		<button className={cn("relative z-10 w-full card-outline p-3 text-left overflow-hidden", moduleJob.status === "pending" && "opacity-50")}>
			<div
				className="absolute inset-0 bg-primary/10 transition-all duration-200"
				style={{ width: `${moduleJob.progress * 100}%` }}
			/>
			<div className="relative flex w-full items-center gap-3">
				<span className="flex-1 truncate text-sm font-medium text-card-foreground">
					{moduleJob.moduleName}
				</span>
				<span className="shrink-0">
					{moduleJob.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
					{moduleJob.status === "completed" && <Check className="h-4 w-4 text-primary" />}
				</span>
			</div>
		</button>
	</Parameters>
);
