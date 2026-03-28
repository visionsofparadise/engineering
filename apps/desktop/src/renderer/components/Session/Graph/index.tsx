import { useCallback, useEffect, useMemo, useState } from "react";
import {
	ReactFlow,
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	useNodesState,
	useEdgesState,
	type Node,
	type Edge,
	type NodeTypes,
	type EdgeTypes,
	type OnConnect,
	type OnNodesChange,
	type OnEdgesChange,
	type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { GraphNode as GNode, GraphEdge as GEdge } from "@e9g/buffered-audio-nodes-core";
import type { SessionContext } from "../../../models/Context";
import { SourceNode, type SourceNodeData } from "./nodes/SourceNode";
import { TransformNode, type TransformNodeData } from "./nodes/TransformNode";
import { TargetNode, type TargetNodeData } from "./nodes/TargetNode";
import { InsertEdge } from "./edges/InsertEdge";
import { ModuleMenu, type ModuleSelection } from "../Chain/ModuleMenu";
import { NodeParameters } from "./NodeParameters";
import { GraphManager } from "./GraphManager";

const SOURCE_MODULES = new Set(["Read"]);
const TARGET_MODULES = new Set(["Write", "Waveform", "Spectrogram"]);
const CHEAP_MODULES = new Set(["Cut", "Phase", "Dither"]);

const NODE_WIDTH = 224;
const NODE_HEIGHT = 60;

const nodeTypes: NodeTypes = {
	source: SourceNode,
	transform: TransformNode,
	target: TargetNode,
};

const edgeTypes: EdgeTypes = {
	insert: InsertEdge,
};

function getNodeType(node: GNode): "source" | "transform" | "target" {
	if (SOURCE_MODULES.has(node.nodeName)) return "source";
	if (TARGET_MODULES.has(node.nodeName)) return "target";

	return "transform";
}

function autoLayout(
	nodes: ReadonlyArray<GNode>,
	edges: ReadonlyArray<GEdge>,
): Record<string, { x: number; y: number }> {
	const g = new dagre.graphlib.Graph();

	g.setDefaultEdgeLabel(() => ({}));
	g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120 });

	for (const node of nodes) {
		g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	}

	for (const edge of edges) {
		g.setEdge(edge.from, edge.to);
	}

	dagre.layout(g);

	const positions: Record<string, { x: number; y: number }> = {};

	for (const node of nodes) {
		const pos = g.node(node.id);

		if (pos) {
			positions[node.id] = { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 };
		}
	}

	return positions;
}

interface GraphEditorProps {
	readonly context: SessionContext;
}

export const GraphEditor: React.FC<GraphEditorProps> = ({ context }) => {
	const { graph, app } = context;
	const { graphDefinition, sessionState, nodeStates } = graph;
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [insertMenuPos, setInsertMenuPos] = useState<{ x: number; y: number; fromId: string; toId: string } | null>(null);
	const [isRendering, setIsRendering] = useState(false);

	const handleRender = useCallback(async () => {
		if (!graphDefinition) return;

		const packageVersions: Record<string, string> = {};

		for (const pkg of app.packages) {
			if (pkg.name && pkg.version) {
				packageVersions[pkg.name] = pkg.version;
			}
		}

		for (const node of graphDefinition.nodes) {
			if (nodeStates.get(node.id) === "stale") {
				graph.updateNodeState(node.id, "processing");
			}
		}

		setIsRendering(true);

		try {
			await window.main.audioRenderGraph({
				graphDefinition,
				packageVersions,
				userDataPath: context.userDataPath,
				binaries: app.binaries as Record<string, string>,
			});

			await graph.recomputeNodeStates();
		} catch {
			await graph.recomputeNodeStates();
		} finally {
			setIsRendering(false);
		}
	}, [graphDefinition, nodeStates, graph, app, context.userDataPath]);

	useEffect(() => {
		if (!graphDefinition || isRendering) return;

		const autoApplyNodes = graphDefinition.nodes.filter((node) => {
			if (!CHEAP_MODULES.has(node.nodeName)) return false;
			if (nodeStates.get(node.id) !== "stale") return false;

			const parentEdge = graphDefinition.edges.find((e) => e.to === node.id);

			if (!parentEdge) return false;

			return nodeStates.get(parentEdge.from) === "applied";
		});

		if (autoApplyNodes.length === 0) return;

		void handleRender();
	}, [graphDefinition, nodeStates, isRendering, handleRender]);

	const positions = useMemo(() => {
		if (!graphDefinition) return {};

		const hasPositions = Object.keys(sessionState.positions).length > 0;

		if (hasPositions) return sessionState.positions;

		return autoLayout(graphDefinition.nodes, graphDefinition.edges);
	}, [graphDefinition, sessionState.positions]);

	const initialNodes = useMemo<Array<Node>>(() => {
		if (!graphDefinition) return [];

		return graphDefinition.nodes.map((node) => {
			const type = getNodeType(node);
			const state = nodeStates.get(node.id) ?? "stale";
			const monitored = sessionState.monitoredNodeId === node.id;
			const pos = positions[node.id] ?? { x: 0, y: 0 };

			const base = {
				id: node.id,
				type,
				position: pos,
			};

			if (type === "source") {
				return {
					...base,
					data: {
						label: node.nodeName,
						fileName: (node.parameters?.path as string) ?? "",
						state,
						monitored,
						onMonitor: () => graph.setMonitor(node.id),
					} satisfies SourceNodeData,
				};
			}

			if (type === "target") {
				return {
					...base,
					data: {
						label: node.nodeName,
						state,
						monitored,
						outputPath: node.parameters?.path as string | undefined,
						format: node.nodeName.toLowerCase(),
						onMonitor: () => graph.setMonitor(node.id),
					} satisfies TargetNodeData,
				};
			}

			return {
				...base,
				data: {
					label: node.nodeName,
					state,
					monitored,
					bypassed: node.options?.bypass ?? false,
					onMonitor: () => graph.setMonitor(node.id),
					onBypassToggle: () => graph.toggleBypass(node.id),
					onClick: () => setSelectedNodeId(node.id),
				} satisfies TransformNodeData,
			};
		});
	}, [graphDefinition, nodeStates, sessionState.monitoredNodeId, positions, graph]);

	const initialEdges = useMemo<Array<Edge>>(() => {
		if (!graphDefinition) return [];

		return graphDefinition.edges.map((edge) => ({
			id: `${edge.from}-${edge.to}`,
			source: edge.from,
			target: edge.to,
			type: "insert" as const,
			data: {
				onInsert: () => {
					setInsertMenuPos((prev) => (prev ? null : { x: 0, y: 0, fromId: edge.from, toId: edge.to }));
				},
			},
		}));
	}, [graphDefinition]);

	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState([]);

	useEffect(() => {
		setNodes(initialNodes);
		setEdges(initialEdges);
	}, [initialNodes, initialEdges, setNodes, setEdges]);

	const handleNodesChange: OnNodesChange = useCallback(
		(changes) => {
			onNodesChange(changes);

			const positionUpdates: Record<string, { x: number; y: number }> = {};
			let hasUpdates = false;

			for (const change of changes) {
				if (change.type === "position" && change.position && !change.dragging) {
					positionUpdates[change.id] = change.position;
					hasUpdates = true;
				}
			}

			if (hasUpdates) {
				graph.updatePositions(positionUpdates);
			}
		},
		[onNodesChange, graph],
	);

	const handleEdgesChange: OnEdgesChange = useCallback(
		(changes) => {
			onEdgesChange(changes);
		},
		[onEdgesChange],
	);

	const handleConnect: OnConnect = useCallback(
		(connection) => {
			if (connection.source && connection.target) {
				graph.addEdge({ from: connection.source, to: connection.target });
			}
		},
		[graph],
	);

	const handleMoveEnd = useCallback(
		(_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
			graph.updateViewport(viewport);
		},
		[graph],
	);

	const handleInsertNode = useCallback(
		(fromId: string, toId: string, selection: ModuleSelection) => {
			const newNode: GNode = {
				id: crypto.randomUUID(),
				packageName: selection.packageName,
				nodeName: selection.moduleName,
			};

			graph.addNode(newNode);
			graph.removeEdge(fromId, toId);
			graph.addEdge({ from: fromId, to: newNode.id });
			graph.addEdge({ from: newNode.id, to: toId });

			setInsertMenuPos(null);
		},
		[graph],
	);

	if (!graphDefinition) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				{graph.isLoading ? "Loading graph..." : "No graph loaded"}
			</div>
		);
	}

	return (
		<div className="relative h-full w-full">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				onNodesChange={handleNodesChange}
				onEdgesChange={handleEdgesChange}
				onConnect={handleConnect}
				onMoveEnd={handleMoveEnd}
				defaultViewport={sessionState.viewport}
				fitView={Object.keys(sessionState.positions).length === 0}
				proOptions={{ hideAttribution: true }}
				minZoom={0.2}
				maxZoom={2}
				deleteKeyCode={["Backspace", "Delete"]}
			>
				<Background variant={BackgroundVariant.Dots} gap={16} size={0.5} color="var(--border)" />
				<Controls showInteractive={false} />
				<MiniMap
					nodeColor={(node) => {
						const state = (node.data as { state?: string }).state;

						if (state === "applied") return "var(--primary)";
						if (state === "processing") return "var(--color-status-processing)";
						if (state === "bypassed") return "var(--muted-foreground)";

						return "var(--border)";
					}}
					maskColor="hsl(var(--background) / 0.7)"
					style={{ background: "var(--card)" }}
				/>
			</ReactFlow>

			<div className="absolute right-4 top-4 z-10 flex items-center gap-2">
				<GraphManager context={context} />
				<button
					className="rounded border border-border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
					disabled={isRendering}
					onClick={() => void handleRender()}
				>
					{isRendering ? "Rendering…" : "Render"}
				</button>
			</div>

			{insertMenuPos && (
				<div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
					<ModuleMenu
						app={app}
						onSelect={(selection) => handleInsertNode(insertMenuPos.fromId, insertMenuPos.toId, selection)}
					/>
				</div>
			)}

			{selectedNodeId && graphDefinition && (
				<NodeParameters
					nodeId={selectedNodeId}
					context={context}
					onClose={() => setSelectedNodeId(null)}
				/>
			)}
		</div>
	);
};

export { type GraphEditorProps };
