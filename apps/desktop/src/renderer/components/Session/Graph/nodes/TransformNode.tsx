import { Position, type NodeProps, type Node } from "@xyflow/react";
import { Loader2 } from "lucide-react";
import type { NodeRenderState } from "../../../../../shared/models/Session";
import { cn } from "../../../../utils/cn";
import { Switch } from "../../../ui/switch";
import { Port } from "./Port";
import { MonitorToggle } from "./MonitorToggle";

export type TransformNodeData = Record<string, unknown> & {
	label: string;
	state: NodeRenderState;
	monitored: boolean;
	bypassed: boolean;
	onMonitor?: () => void;
	onBypassToggle?: () => void;
	onClick?: () => void;
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

export function TransformNode({ data }: NodeProps<Node<TransformNodeData>>) {
	const effectiveState = data.bypassed ? "bypassed" : data.state;

	return (
		<div className="w-56">
			<Port type="target" position={Position.Left} />
			<div
				className={cn(
					"cursor-pointer px-3 py-2.5 transition-colors",
					nodeContainerClass(effectiveState),
				)}
				onClick={data.onClick}
			>
				<div className="flex items-center gap-2.5">
					{effectiveState === "processing" && (
						<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-status-processing)]" />
					)}
					<div className="min-w-0 flex-1">
						<span
							className={cn(
								"block text-sm font-medium text-card-foreground",
								data.bypassed && "line-through text-muted-foreground",
							)}
						>
							{data.label}
						</span>
					</div>
					<Switch
						checked={!data.bypassed}
						onCheckedChange={() => data.onBypassToggle?.()}
						onClick={(ev) => ev.stopPropagation()}
						onPointerDown={(ev) => ev.stopPropagation()}
					/>
					<MonitorToggle
						active={data.monitored}
						visible={hasSnapshot(effectiveState)}
						onToggle={data.onMonitor}
					/>
				</div>
			</div>
			<Port type="source" position={Position.Right} />
		</div>
	);
}
