import { Icon } from "@iconify/react";
import type { GraphContext } from "../../../../models/Context";

interface Props {
	readonly context: GraphContext;
}

const EDGE_LEGEND_ITEMS: ReadonlyArray<{ readonly label: string; readonly color: string }> = [
	{ label: "Idle", color: "var(--color-edge-idle)" },
	{ label: "Active", color: "var(--color-edge-active)" },
	{ label: "Complete", color: "var(--color-edge-complete)" },
];

export function TopLeftOverlay({ context }: Props) {
	const { inspectedNodeId } = context.graph;
	const inspectedNode = inspectedNodeId !== null
		? context.graphDefinition.nodes.find((node) => node.id === inspectedNodeId)
		: undefined;

	return (
		<div className="absolute left-3 top-3 z-10 flex items-center gap-3">
			<div className="flex items-center gap-4 bg-chrome-surface px-3 py-2">
				{EDGE_LEGEND_ITEMS.map((item) => (
					<div key={item.label} className="flex items-center gap-1.5">
						<svg width={16} height={3}>
							<line x1={0} y1={1.5} x2={16} y2={1.5} stroke={item.color} strokeWidth={1.5} />
						</svg>
						<span className="font-technical uppercase tracking-[0.06em] text-chrome-text-secondary text-[length:var(--text-xs)]">
							{item.label}
						</span>
					</div>
				))}
			</div>

			{inspectedNode && (
				<div className="flex items-center gap-2 bg-chrome-surface px-3 py-2">
					<Icon icon="lucide:eye" width={14} height={14} className="text-primary" />
					<span className="font-technical uppercase tracking-[0.06em] text-chrome-text-dim text-[length:var(--text-xs)]">
						Inspecting:
					</span>
					<span className="font-body text-chrome-text text-[length:var(--text-sm)]">
						{inspectedNode.nodeName}
					</span>
				</div>
			)}
		</div>
	);
}
