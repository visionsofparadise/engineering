import { useCallback, useState } from "react";
import {
	ReactFlow,
	Background,
	BackgroundVariant,
	Controls,
	useNodesState,
	useEdgesState,
	addEdge,
	Handle,
	Position,
	BaseEdge,
	EdgeLabelRenderer,
	getBezierPath,
	type Node,
	type Edge,
	type NodeTypes,
	type EdgeTypes,
	type OnConnect,
	type NodeProps,
	type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FileAudio, Download, BarChart3, AudioWaveform, Eye, Plus } from "lucide-react";
import { cn } from "../utils/cn";
import { Switch } from "../components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { Slider } from "../components/ui/slider";
import { Label } from "../components/ui/label";
import { ButtonBank } from "../components/ui/button-bank";

type NodeState = "empty" | "applied" | "stale" | "bypassed" | "processing";

type SourceNodeData = Record<string, unknown> & {
	label: string;
	fileName: string;
	state: NodeState;
	monitored: boolean;
};

type TransformNodeData = Record<string, unknown> & {
	label: string;
	description: string;
	state: NodeState;
	monitored: boolean;
	parameters: Array<DemoParameter>;
};

type TargetNodeData = Record<string, unknown> & {
	label: string;
	description: string;
	state: NodeState;
	monitored: boolean;
	outputPath?: string;
	format?: string;
};

type DemoParameter =
	| { type: "slider"; name: string; min: number; max: number; step: number; value: number; unit: string }
	| { type: "select"; name: string; options: Array<string>; value: string };

function Port({ type, position }: { type: "source" | "target"; position: Position }) {
	return (
		<Handle
			type={type}
			position={position}
			className="!h-2.5 !w-2.5 !rounded-full !border !border-border !bg-[var(--surface-control)]"
			style={{ boxShadow: "var(--shadow-raised)" }}
		/>
	);
}

function hasSnapshot(state: NodeState) {
	return state === "applied" || state === "processing";
}

function MonitorToggle({ active, visible }: { active: boolean; visible: boolean }) {
	if (!visible) return null;
	return (
		<button
			onClick={(ev) => ev.stopPropagation()}
			onPointerDown={(ev) => ev.stopPropagation()}
			className={cn(
				"flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all",
				active
					? "text-[var(--color-status-processing)]"
					: "text-muted-foreground/30 hover:text-muted-foreground/60",
			)}
		>
			<Eye className="h-3.5 w-3.5" />
		</button>
	);
}

function nodeContainerClass(state: NodeState) {
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

function InsertEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) {
	const [edgePath, labelX, labelY] = getBezierPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
	});

	return (
		<>
			<BaseEdge id={id} path={edgePath} style={{ stroke: "var(--border)", strokeWidth: 1 }} />
			<EdgeLabelRenderer>
				<div
					className="nodrag nopan pointer-events-auto absolute"
					style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
				>
					<button
						className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground/40 transition-all hover:border-primary hover:text-primary"
						onClick={(ev) => ev.stopPropagation()}
					>
						<Plus className="h-3 w-3" />
					</button>
				</div>
			</EdgeLabelRenderer>
		</>
	);
}

function SourceNode({ data }: NodeProps<Node<SourceNodeData>>) {
	return (
		<div className="w-56">
			<div className={cn(
				"flex items-center gap-2.5 px-3 py-2.5",
				nodeContainerClass(data.state),
			)}>
				<FileAudio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<span className="block font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">Source</span>
					<span className="block truncate font-mono text-xs text-card-foreground">{data.fileName}</span>
				</div>
				<MonitorToggle active={data.monitored} visible={hasSnapshot(data.state)} />
			</div>
			<Port type="source" position={Position.Right} />
		</div>
	);
}

function TransformNode({ data }: NodeProps<Node<TransformNodeData>>) {
	const isBypassed = data.state === "bypassed";
	const [bypassed, setBypassed] = useState(isBypassed);
	const [paramValues, setParamValues] = useState<Record<string, string | number>>(() =>
		Object.fromEntries(data.parameters.map((param) => [param.name, param.value]))
	);

	const effectiveState = bypassed ? "bypassed" : data.state;

	return (
		<div className="w-56">
			<Port type="target" position={Position.Left} />
			<Popover>
				<PopoverTrigger asChild>
					<div className={cn(
						"cursor-pointer px-3 py-2.5 transition-colors",
						nodeContainerClass(effectiveState),
					)}>
						<div className="flex items-center gap-2.5">
							<div className="min-w-0 flex-1">
								<span className={cn(
									"block text-sm font-medium text-card-foreground",
									bypassed && "line-through text-muted-foreground",
								)}>
									{data.label}
								</span>
							</div>
							<MonitorToggle active={data.monitored} visible={hasSnapshot(effectiveState)} />
						</div>
					</div>
				</PopoverTrigger>
				<PopoverContent className="w-64" side="bottom" align="start">
					<div>
						<div className="mb-4 flex items-center justify-between">
							<Label className="text-[0.6875rem]">Bypass</Label>
							<Switch
								checked={bypassed}
								onCheckedChange={setBypassed}
							/>
						</div>
						<div className="mb-4 border-t border-border pt-4">
							<p className="text-[0.6875rem] text-muted-foreground">{data.description}</p>
						</div>
						<div className="space-y-5">
							{data.parameters.map((param) => {
								if (param.type === "slider") {
									return (
										<div key={param.name}>
											<div className="mb-2 flex items-baseline justify-between">
												<Label className="text-[0.6875rem]">{param.name}</Label>
												<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
													{paramValues[param.name]}{param.unit ? ` ${param.unit}` : ""}
												</span>
											</div>
											<Slider
												value={[paramValues[param.name] as number]}
												onValueChange={(values) => { const next = values[0]; if (next !== undefined) setParamValues((prev) => ({ ...prev, [param.name]: next })); }}
												min={param.min}
												max={param.max}
												step={param.step}
											/>
										</div>
									);
								}
								return (
									<div key={param.name}>
										<Label className="mb-2 block text-[0.6875rem]">{param.name}</Label>
										<ButtonBank
											value={paramValues[param.name] as string}
											onValueChange={(selected) => setParamValues((prev) => ({ ...prev, [param.name]: selected }))}
											options={param.options}
										/>
									</div>
								);
							})}
						</div>
					</div>
				</PopoverContent>
			</Popover>
			<Port type="source" position={Position.Right} />
		</div>
	);
}

function TargetNode({ data }: NodeProps<Node<TargetNodeData>>) {
	const Icon = data.format === "loudness-stats" ? BarChart3
		: data.format === "waveform" ? AudioWaveform
		: Download;
	const isExport = !!data.outputPath;

	return (
		<div className="w-56">
			<Port type="target" position={Position.Left} />
			<div className={cn(
				"flex items-center gap-2.5 px-3 py-2.5",
				isExport && data.state !== "empty"
					? "border border-primary/40 bg-card"
					: nodeContainerClass(data.state),
			)}>
				<Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<div className="min-w-0 flex-1">
					<span className="block font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
						{data.label}
					</span>
					{data.outputPath && (
						<span className="block truncate font-mono text-[0.625rem] text-card-foreground/70">{data.outputPath}</span>
					)}
				</div>
				<MonitorToggle active={data.monitored} visible={hasSnapshot(data.state)} />
			</div>
		</div>
	);
}

const nodeTypes: NodeTypes = {
	source: SourceNode,
	transform: TransformNode,
	target: TargetNode,
};

const edgeTypes: EdgeTypes = {
	insert: InsertEdge,
};

const DEMO_NODES: Array<Node> = [
	{
		id: "source",
		type: "source",
		position: { x: 0, y: 160 },
		data: { label: "Source", fileName: "podcast_ep47_raw.wav", state: "applied", monitored: false },
		draggable: true,
	},
	{
		id: "denoise",
		type: "transform",
		position: { x: 280, y: 160 },
		data: {
			label: "Voice Denoise",
			description: "Remove background noise from voice recordings using ML model",
			state: "bypassed",
			monitored: false,
			parameters: [
				{ type: "slider", name: "Strength", min: 0, max: 1, step: 0.01, value: 0.65, unit: "" },
			],
		},
		draggable: true,
	},
	{
		id: "normalize",
		type: "transform",
		position: { x: 560, y: 160 },
		data: {
			label: "Normalize",
			description: "Adjust peak level to target ceiling",
			state: "applied",
			monitored: true,
			parameters: [
				{ type: "slider", name: "Ceiling", min: -12, max: 0, step: 0.1, value: -1, unit: "dB" },
			],
		},
		draggable: true,
	},
	{
		id: "loudness",
		type: "transform",
		position: { x: 840, y: 160 },
		data: {
			label: "Loudness",
			description: "Normalize integrated loudness to target LUFS",
			state: "stale",
			monitored: false,
			parameters: [
				{ type: "slider", name: "Target", min: -50, max: 0, step: 0.1, value: -14, unit: "LUFS" },
				{ type: "slider", name: "True Peak", min: -10, max: 0, step: 0.1, value: -1, unit: "dBTP" },
				{ type: "select", name: "Standard", options: ["EBU R128", "ATSC A/85", "Custom"], value: "EBU R128" },
			],
		},
		draggable: true,
	},
	{
		id: "write-wav",
		type: "target",
		position: { x: 1120, y: 40 },
		data: {
			label: "WAV Output",
			description: "Write processed audio as WAV",
			state: "stale",
			monitored: false,
			outputPath: "/export/podcast_ep47.wav",
			format: "wav",
		},
		draggable: true,
	},
	{
		id: "write-mp3",
		type: "target",
		position: { x: 1120, y: 160 },
		data: {
			label: "MP3 Output",
			description: "Write processed audio as MP3",
			state: "stale",
			monitored: false,
			outputPath: "/export/podcast_ep47.mp3",
			format: "mp3",
		},
		draggable: true,
	},
	{
		id: "loudness-stats",
		type: "target",
		position: { x: 1120, y: 280 },
		data: {
			label: "Loudness Stats",
			description: "Compute loudness statistics",
			state: "stale",
			monitored: false,
			format: "loudness-stats",
		},
		draggable: true,
	},
];

const DEMO_EDGES: Array<Edge> = [
	{ id: "e-source-denoise", source: "source", target: "denoise", type: "insert" },
	{ id: "e-denoise-normalize", source: "denoise", target: "normalize", type: "insert" },
	{ id: "e-normalize-loudness", source: "normalize", target: "loudness", type: "insert" },
	{ id: "e-loudness-wav", source: "loudness", target: "write-wav", type: "insert" },
	{ id: "e-loudness-mp3", source: "loudness", target: "write-mp3", type: "insert" },
	{ id: "e-loudness-stats", source: "loudness", target: "loudness-stats", type: "insert" },
];

const CONTEXT_MENU_ITEMS = [
	{ label: "Add Transform", items: ["Voice Denoise", "Normalize", "Loudness", "Trim", "Cut", "De-Click", "EQ Match"] },
	{ label: "Add Target", items: ["WAV Output", "MP3 Output", "Loudness Stats", "Waveform", "Spectrogram"] },
];

export function GraphEditor() {
	const [nodes, , onNodesChange] = useNodesState(DEMO_NODES);
	const [edges, setEdges, onEdgesChange] = useEdgesState(DEMO_EDGES);
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

	const onConnect: OnConnect = useCallback(
		(connection) => setEdges((eds) => addEdge({ ...connection, id: `e-${connection.source}-${connection.target}`, type: "insert" }, eds)),
		[setEdges],
	);

	const onPaneContextMenu = useCallback((ev: MouseEvent | React.MouseEvent) => {
		ev.preventDefault();
		setContextMenu({ x: ev.clientX, y: ev.clientY });
	}, []);

	const onPaneClick = useCallback(() => {
		setContextMenu(null);
	}, []);

	return (
		<div className="space-y-8">
			<div>
				<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Processing Graph — Node Editor
				</h4>
				<div className="graph-editor-canvas relative border border-border bg-background" style={{ height: 480 }}>
					<ReactFlow
						nodes={nodes}
						edges={edges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onConnect={onConnect}
						onPaneContextMenu={onPaneContextMenu}
						onPaneClick={onPaneClick}
						nodeTypes={nodeTypes}
						edgeTypes={edgeTypes}
						fitView
						fitViewOptions={{ padding: 0.2 }}
						proOptions={{ hideAttribution: true }}
						defaultEdgeOptions={{ type: "insert" }}
					>
						<Background
							variant={BackgroundVariant.Lines}
							gap={24}
							size={1}
						/>
						<Controls showInteractive={false} />
					</ReactFlow>
					{contextMenu && (
						<CanvasContextMenu
							position={contextMenu}
							onClose={() => setContextMenu(null)}
						/>
					)}
				</div>
			</div>

			<div className="h-px bg-border" />

			<NodeStatesLegend />
		</div>
	);
}

function CanvasContextMenu({ position, onClose }: { position: { x: number; y: number }; onClose: () => void }) {
	return (
		<div
			className="fixed z-50 min-w-48 border border-border bg-popover py-1 text-popover-foreground"
			style={{ left: position.x, top: position.y, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
			onClick={onClose}
		>
			{CONTEXT_MENU_ITEMS.map((group) => (
				<div key={group.label}>
					<div className="px-3 py-1.5 font-mono text-[0.5625rem] uppercase tracking-wider text-muted-foreground">
						{group.label}
					</div>
					{group.items.map((item) => (
						<button
							key={item}
							className="block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
							onClick={onClose}
						>
							{item}
						</button>
					))}
				</div>
			))}
		</div>
	);
}

function NodeStatesLegend() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Node States
			</h4>
			<div className="flex flex-wrap gap-6 text-xs text-muted-foreground">
				<div className="flex items-center gap-2">
					<div className="h-4 w-10 border border-border/60" />
					<span>Empty</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="h-4 w-10 border border-primary bg-card" />
					<span>Applied</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="h-4 w-10 border border-border bg-card" />
					<span>Stale</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="h-4 w-10 border border-border bg-card opacity-50">
						<span className="block px-1 pt-0.5 font-mono text-[6px] line-through text-muted-foreground">abc</span>
					</div>
					<span>Bypassed</span>
				</div>
				<div className="flex items-center gap-2">
					<div className="h-4 w-10 border border-[var(--color-status-processing)]/40 bg-card" />
					<span>Processing</span>
				</div>
				<div className="flex items-center gap-2">
					<Eye className="h-3.5 w-3.5 text-[var(--color-status-processing)]" />
					<span>Monitored</span>
				</div>
			</div>
		</div>
	);
}
