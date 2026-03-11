import { Check, Loader2, X } from "lucide-react";
import type { BatchFile } from "../../models/State/App";
import type { JobState } from "../../models/State/Jobs";
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
		<div className="relative flex items-center gap-1 overflow-hidden rounded border border-border px-2 py-1.5">
			{status === "running" && (
				<div
					className="absolute inset-0 bg-primary/10 transition-all duration-200"
					style={{ width: `${progress * 100}%` }}
				/>
			)}
			<span
				className="relative flex-1 truncate text-xs"
				title={file.path}
			>
				{name}
			</span>
			<span className="relative shrink-0">
				{status === "idle" && !running && (
					<Button
						variant="ghost"
						size="icon"
						className="h-5 w-5"
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
						className="h-5 w-5"
						onClick={onAbort}
					>
						<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
					</Button>
				)}
				{status === "completed" && <Check className="h-3 w-3 text-primary" />}
				{status === "aborted" && <span className="text-[10px] text-destructive">Aborted</span>}
			</span>
		</div>
	);
};
