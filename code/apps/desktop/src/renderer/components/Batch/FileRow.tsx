import { Check, Loader2, X } from "lucide-react";
import type { BatchFile } from "../../models/State/App";
import type { JobState } from "../../models/State/Jobs";
import { cn } from "../../utils/cn";
import { Button } from "../ui/button";

interface FileRowProps {
	readonly file: BatchFile;
	readonly name: string;
	readonly jobState: JobState | undefined;
	readonly running: boolean;
	readonly onRemove: () => void;
	readonly onAbort: () => void;
}

export const FileRow: React.FC<FileRowProps> = ({ file, name, jobState, running, onRemove, onAbort }) => {
	const status = jobState?.status ?? "idle";
	const progress = jobState?.modules[0]?.progress ?? 0;

	return (
		<div className={cn("relative card-outline p-0 overflow-hidden", status === "idle" && running && "opacity-50")}>
			{status === "running" && (
				<div
					className="absolute inset-0 bg-primary/10 transition-all duration-200"
					style={{ width: `${progress * 100}%` }}
				/>
			)}
			<div className="relative flex items-center gap-3 px-3 py-2">
				<span
					className="flex-1 truncate text-sm font-medium text-card-foreground"
					title={file.path}
				>
					{name}
				</span>
				<span className="shrink-0">
					{status === "idle" && !running && (
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6"
							onClick={onRemove}
						>
							<X className="h-3 w-3" />
						</Button>
					)}
					{status === "idle" && running && <span className="text-[10px] text-muted-foreground">Queued</span>}
					{status === "running" && (
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6"
							onClick={onAbort}
						>
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						</Button>
					)}
					{status === "completed" && <Check className="h-4 w-4 text-primary" />}
					{status === "aborted" && <span className="text-[10px] text-muted-foreground">Aborted</span>}
				</span>
			</div>
		</div>
	);
};
