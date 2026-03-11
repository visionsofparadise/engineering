import type { ChainDefinition } from "@engineering/acm";
import { Check, Loader2 } from "lucide-react";
import type { ModuleJobState } from "../../../models/State/Jobs";
import { Parameters } from "./Parameters/Parameters";

interface JobSlotProps {
	readonly moduleJob: ModuleJobState;
	readonly index: number;
	readonly chain: ChainDefinition;
	readonly setChain: (updater: (chain: ChainDefinition) => ChainDefinition) => void;
}

export const JobSlot: React.FC<JobSlotProps> = ({ moduleJob, index, chain, setChain }) => (
	<div className="relative flex items-center gap-1 overflow-hidden rounded border border-border px-2 py-1.5">
		<div
			className="absolute inset-0 bg-primary/10 transition-all duration-200"
			style={{ width: `${moduleJob.progress * 100}%` }}
		/>
		<span
			className={`relative flex-1 truncate text-xs ${moduleJob.status === "pending" ? "opacity-40" : ""}`}
		>
			{moduleJob.moduleName}
		</span>
		<Parameters module={moduleJob.moduleName} index={index} chain={chain} setChain={setChain} disabled />
		<span className="relative shrink-0">
			{moduleJob.status === "running" && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
			{moduleJob.status === "completed" && <Check className="h-3 w-3 text-primary" />}
		</span>
	</div>
);
