import type { AudioNodeData, NodeCategory } from "@e9g/design-system";
import { AudioEdge, AudioNode } from "@e9g/design-system";
import {
	Background,
	BackgroundVariant,
	Controls,
	MiniMap,
	ReactFlow,
	useEdgesState,
	useNodesState,
	useReactFlow,
	type Connection,
	type Edge,
	type EdgeTypes,
	type Node,
	type NodeChange,
	type NodeMouseHandler,
	type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphContext } from "../../../models/Context";
import { GraphContextMenu, NODE_MENU_ITEMS, PANE_MENU_ITEMS, type ContextMenuAction, type ContextMenuPosition } from "./GraphContextMenu";
import { useGraphMutations } from "./hooks/useGraphMutations";
import { NodePicker } from "./NodePicker";

interface AudioEdgeData {
	readonly state: "idle" | "active" | "complete";
	[key: string]: unknown;
}

interface NodePickerState {
	readonly x: number;
	readonly y: number;
}

function AudioNodeWrapper(props: React.ComponentProps<typeof AudioNode>) {
	return <AudioNode {...props} />;
}

const NODE_TYPES: NodeTypes = { audioNode: AudioNodeWrapper };
const EDGE_TYPES: EdgeTypes = { audioEdge: AudioEdge };

function lookupModule(context: GraphContext, packageName: string, nodeName: string): { category: NodeCategory; moduleDescription: string } {
	for (const modulePackage of context.app.packages) {
		if (modulePackage.name === packageName) {
			for (const mod of modulePackage.modules) {
				if (mod.moduleName === nodeName) {
					return {
						category: mod.category,
						moduleDescription: mod.moduleDescription,
					};
				}
			}
		}
	}

	return { category: "transform", moduleDescription: "" };
}

function buildReactFlowNodes(context: GraphContext): Array<Node<AudioNodeData>> {
	return context.graphDefinition.nodes.map((graphNode) => {
		const { category, moduleDescription } = lookupModule(context, graphNode.packageName, graphNode.nodeName);

		return {
			id: graphNode.id,
			type: "audioNode",
			position: context.graph.positions[graphNode.id] ?? { x: 0, y: 0 },
			data: {
				label: graphNode.nodeName,
				category,
				state: "pending",
				bypassed: graphNode.options?.bypass ?? false,
				parameters: [],
				inspected: graphNode.id === context.graph.inspectedNodeId,
				description: moduleDescription,
			},
		};
	});
}

function buildReactFlowEdges(context: GraphContext): Array<Edge<AudioEdgeData>> {
	return context.graphDefinition.edges.map((edge) => ({
		id: `${edge.from}-${edge.to}`,
		source: edge.from,
		target: edge.to,
		sourceHandle: "source",
		targetHandle: "target",
		type: "audioEdge",
		data: { state: "idle" },
	}));
}

interface Props {
	readonly context: GraphContext;
}

export function GraphCanvas({ context }: Props) {
	const initialNodes = useMemo(
		() => buildReactFlowNodes(context),

		[],
	);
	const initialEdges = useMemo(
		() => buildReactFlowEdges(context),

		[],
	);

	const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
	const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);
	const [nodePicker, setNodePicker] = useState<NodePickerState | null>(null);

	const { screenToFlowPosition, getNodes } = useReactFlow();
	const mutations = useGraphMutations(context);

	// Sync from graph definition (source of truth) into React Flow state
	useEffect(() => {
		setNodes(buildReactFlowNodes(context));
		setEdges(buildReactFlowEdges(context));
	}, [context, setNodes, setEdges]);

	const handleNodesChange = useCallback(
		(changes: Array<NodeChange<Node<AudioNodeData>>>) => {
			onNodesChange(changes);

			for (const change of changes) {
				if (change.type === "position" && change.position && !change.dragging) {
					const nodeId = change.id;
					const position = change.position;

					context.graphStore.mutate(context.graph, (proxy) => {
						proxy.positions[nodeId] = { x: position.x, y: position.y };
					});
				}
			}
		},
		[onNodesChange, context],
	);

	const handleConnect = useCallback(
		(connection: Connection) => {
			mutations.addEdge(connection.source, connection.target);
		},
		[mutations],
	);

	const handleNodeContextMenu: NodeMouseHandler<Node> = useCallback((event, node) => {
		event.preventDefault();
		setNodePicker(null);
		setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
	}, []);

	const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
		event.preventDefault();
		setNodePicker(null);
		setContextMenu({ x: event.clientX, y: event.clientY });
	}, []);

	const handlePaneClick = useCallback(() => {
		setContextMenu(null);
		setNodePicker(null);
	}, []);

	const closeContextMenu = useCallback(() => {
		setContextMenu(null);
	}, []);

	const handleContextMenuAction = useCallback(
		(action: ContextMenuAction) => {
			if (!contextMenu) return;

			switch (action) {
				case "add": {
					setNodePicker({ x: contextMenu.x, y: contextMenu.y });
					setContextMenu(null);
					break;
				}

				case "delete": {
					if (contextMenu.nodeId) {
						mutations.removeNode(contextMenu.nodeId);
					}

					setContextMenu(null);
					break;
				}

				case "bypass": {
					if (contextMenu.nodeId) {
						mutations.toggleBypass(contextMenu.nodeId);
					}

					setContextMenu(null);
					break;
				}

				case "render": {
					// Render-related features are Plan 7+
					setContextMenu(null);
					break;
				}
			}
		},
		[contextMenu, mutations],
	);

	const handleNodePickerSelect = useCallback(
		(packageName: string, nodeName: string) => {
			if (!nodePicker) return;

			const flowPosition = screenToFlowPosition({ x: nodePicker.x, y: nodePicker.y });

			mutations.addNode(packageName, nodeName, flowPosition);
			setNodePicker(null);
		},
		[nodePicker, screenToFlowPosition, mutations],
	);

	const closeNodePicker = useCallback(() => {
		setNodePicker(null);
	}, []);

	// Keyboard shortcuts: undo/redo, delete selected nodes
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			// Don't capture when an input/textarea is focused
			const target = event.target as HTMLElement;

			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
				return;
			}

			if (event.ctrlKey && event.shiftKey && event.key === "Z") {
				event.preventDefault();
				context.redo();

				return;
			}

			if (event.ctrlKey && event.key === "z") {
				event.preventDefault();
				context.undo();

				return;
			}

			if (event.key === "Delete" || event.key === "Backspace") {
				const selectedNodes = getNodes().filter((node) => node.selected);

				if (selectedNodes.length > 0) {
					event.preventDefault();
					for (const node of selectedNodes) {
						mutations.removeNode(node.id);
					}
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [context, getNodes, mutations]);

	const contextMenuItems = contextMenu?.nodeId ? NODE_MENU_ITEMS : PANE_MENU_ITEMS;

	return (
		<div className="relative h-full w-full">
			<style>{`
				.react-flow {
					--xy-background-color: var(--color-void);
					--xy-node-border-radius: 0;
					--xy-node-boxshadow-default: 0 2px 8px rgba(0, 0, 0, 0.5);
					--xy-node-boxshadow-hover: 0 4px 16px rgba(0, 0, 0, 0.6);
					--xy-node-boxshadow-selected: 0 4px 16px rgba(0, 0, 0, 0.6);
					--xy-minimap-background: var(--color-chrome-surface);
					--xy-minimap-mask-background: var(--color-chrome-base);
					--xy-controls-button-background: var(--color-chrome-raised);
					--xy-controls-button-color: var(--color-chrome-text);
					--xy-controls-button-border-color: transparent;
					--xy-edge-stroke-default: var(--color-edge-idle);
					--xy-handle-background: var(--color-chrome-surface);
					--xy-handle-border-color: transparent;
					--xy-selection-background: var(--color-data-selection);
					--xy-selection-border: none;
				}

				.react-flow .react-flow__controls {
					border: none;
					border-radius: 0;
					box-shadow: none;
					background: var(--color-chrome-raised);
				}

				.react-flow .react-flow__controls button {
					background: var(--color-chrome-raised);
					border: none;
					border-radius: 0;
					width: 28px;
					height: 28px;
					padding: 4px;
				}

				.react-flow .react-flow__controls button:hover {
					background: var(--color-interactive-hover);
				}

				.react-flow .react-flow__controls svg {
					fill: var(--color-chrome-text);
				}

				.react-flow .react-flow__minimap {
					border: none;
					border-radius: 0;
					box-shadow: none;
					background: var(--color-chrome-surface);
				}

				.react-flow .react-flow__node {
					border-radius: 0;
					box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
					padding: 0;
				}

				.react-flow .react-flow__attribution {
					display: none;
				}

				@keyframes pulse-header {
					0%, 100% { opacity: 1; }
					50% { opacity: 0.5; }
				}

				@keyframes dash-flow {
					from { stroke-dashoffset: 10; }
					to { stroke-dashoffset: 0; }
				}
			`}</style>

			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={handleNodesChange}
				onEdgesChange={onEdgesChange}
				onConnect={handleConnect}
				nodeTypes={NODE_TYPES}
				edgeTypes={EDGE_TYPES}
				onNodeContextMenu={handleNodeContextMenu}
				onPaneContextMenu={handlePaneContextMenu}
				onPaneClick={handlePaneClick}
				fitView
				fitViewOptions={{ padding: 0.3 }}
				defaultEdgeOptions={{ type: "audioEdge" }}
				proOptions={{ hideAttribution: true }}
			>
				<Background
					variant={BackgroundVariant.Dots}
					gap={20}
					size={1}
					color="var(--chrome-border-subtle)"
				/>
				<MiniMap
					nodeColor="var(--chrome-raised)"
					nodeStrokeColor="var(--chrome-border-subtle)"
					nodeStrokeWidth={1}
					maskColor="var(--chrome-base)"
					position="bottom-left"
					pannable
					zoomable
				/>
				<Controls
					showInteractive={false}
					position="bottom-left"
					style={{ marginLeft: 220 }}
				/>
			</ReactFlow>

			{contextMenu && (
				<GraphContextMenu
					position={contextMenu}
					items={contextMenuItems}
					onAction={handleContextMenuAction}
					onClose={closeContextMenu}
				/>
			)}

			{nodePicker && (
				<NodePicker
					app={context.app}
					onSelect={handleNodePickerSelect}
					onClose={closeNodePicker}
					position={nodePicker}
				/>
			)}
		</div>
	);
}
