import { Position, type NodeProps, type Node } from "@xyflow/react";
import { FileAudio } from "lucide-react";
import type { NodeRenderState } from "../../../../../shared/models/Session";
import { cn } from "../../../../utils/cn";
import { Port } from "./Port";
import { MonitorToggle } from "./MonitorToggle";

export type SourceNodeData = Record<string, unknown> & {
	label: string;
	fileName: string;
	state: NodeRenderState;
	monitored: boolean;
	onMonitor?: () => void;
};

function nodeContainerClass(state: NodeRenderState) {
	switch (state) {
		case "empty":
			return "border border-border/60 bg-transparent";
		case "applied":
			return "border border-primary bg-card";
		case "stale":
			return "border border-border bg-card";
		case "bypassed":
			return "border border-border bg-card opacity-50";
		case "processing":
			return "border border-[var(--color-status-processing)]/40 bg-card";
	}
}

function hasSnapshot(state: NodeRenderState) {
	return state === "applied" || state === "processing";
}

export function SourceNode({ data }: NodeProps<Node<SourceNodeData>>) {
	return (
		<div className="w-56">
			<div
				className={cn(
					"flex items-center gap-2.5 px-3 py-2.5",
					nodeContainerClass(data.state),
				)}
			>
				<FileAudio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<span className="block font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
						Source
					</span>
					<span className="block truncate font-mono text-xs text-card-foreground">
						{data.fileName}
					</span>
				</div>
				<MonitorToggle
					active={data.monitored}
					visible={hasSnapshot(data.state)}
					onToggle={data.onMonitor}
				/>
			</div>
			<Port type="source" position={Position.Right} />
		</div>
	);
}
