import { Position, type NodeProps, type Node } from "@xyflow/react";
import { Download, BarChart3, AudioWaveform } from "lucide-react";
import type { NodeRenderState } from "../../../../../shared/models/Session";
import { cn } from "../../../../utils/cn";
import { Port } from "./Port";
import { MonitorToggle } from "./MonitorToggle";

export type TargetNodeData = Record<string, unknown> & {
	label: string;
	state: NodeRenderState;
	monitored: boolean;
	outputPath?: string;
	format?: string;
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

function formatIcon(format?: string) {
	if (format === "loudness-stats") return BarChart3;
	if (format === "waveform") return AudioWaveform;

	return Download;
}

export function TargetNode({ data }: NodeProps<Node<TargetNodeData>>) {
	const Icon = formatIcon(data.format);
	const isExport = !!data.outputPath;

	return (
		<div className="w-56">
			<Port type="target" position={Position.Left} />
			<div
				className={cn(
					"flex items-center gap-2.5 px-3 py-2.5",
					isExport && data.state !== "empty"
						? "border border-primary/40 bg-card"
						: nodeContainerClass(data.state),
				)}
			>
				<Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<span className="block font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
						{data.label}
					</span>
					{data.outputPath && (
						<span className="block truncate font-mono text-[0.625rem] text-card-foreground/70">
							{data.outputPath}
						</span>
					)}
				</div>
				<MonitorToggle
					active={data.monitored}
					visible={hasSnapshot(data.state)}
					onToggle={data.onMonitor}
				/>
			</div>
		</div>
	);
}
