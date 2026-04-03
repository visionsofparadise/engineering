import type { GraphEdge, GraphNode } from "@e9g/buffered-audio-nodes-core";
import type { GraphContext } from "../../../../models/Context";

interface Position {
	x: number;
	y: number;
}

interface GraphMutations {
	addNode: (packageName: string, nodeName: string, position: Position) => void;
	removeNode: (nodeId: string) => void;
	addEdge: (from: string, to: string) => void;
	removeEdge: (from: string, to: string) => void;
	insertNodeOnEdge: (edge: GraphEdge, packageName: string, nodeName: string) => void;
	toggleBypass: (nodeId: string) => void;
	setGraphName: (name: string) => void;
	updateNodeParameters: (nodeId: string, parameterName: string, value: unknown) => void;
}

export function useGraphMutations(context: GraphContext): GraphMutations {
	const { graphDefinition, mutateDefinition, pushHistory } = context;

	function addNode(packageName: string, nodeName: string, position: Position): void {
		const id = crypto.randomUUID();

		const node: GraphNode = {
			id,
			packageName,
			nodeName,
			parameters: {},
		};

		mutateDefinition((definition) => ({
			...definition,
			nodes: [...definition.nodes, node],
		}));

		context.graphStore.mutate(context.graph, (proxy) => {
			proxy.positions[id] = { x: position.x, y: position.y };
		});

		pushHistory({
			label: `Add ${nodeName}`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.filter((node) => node.id !== id),
				}));
				context.graphStore.mutate(context.graph, (proxy) => {
					const { [id]: _removedPosition, ...remainingPositions } = proxy.positions;

					proxy.positions = remainingPositions;
				});
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: [...definition.nodes, node],
				}));
				context.graphStore.mutate(context.graph, (proxy) => {
					proxy.positions[id] = { x: position.x, y: position.y };
				});
			},
		});
	}

	function removeNode(nodeId: string): void {
		const removedNode = graphDefinition.nodes.find((node) => node.id === nodeId);
		const removedEdges = graphDefinition.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
		const removedPosition = graphDefinition.nodes.find((node) => node.id === nodeId) ? context.graph.positions[nodeId] : undefined;

		mutateDefinition((definition) => ({
			...definition,
			nodes: definition.nodes.filter((node) => node.id !== nodeId),
			edges: definition.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
		}));

		context.graphStore.mutate(context.graph, (proxy) => {
			const { [nodeId]: _removedPosition, ...remainingPositions } = proxy.positions;

			proxy.positions = remainingPositions;
		});

		pushHistory({
			label: `Remove node`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: removedNode ? [...definition.nodes, removedNode] : definition.nodes,
					edges: [...definition.edges, ...removedEdges],
				}));
				if (removedPosition) {
					context.graphStore.mutate(context.graph, (proxy) => {
						proxy.positions[nodeId] = { x: removedPosition.x, y: removedPosition.y };
					});
				}
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.filter((node) => node.id !== nodeId),
					edges: definition.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId),
				}));
				context.graphStore.mutate(context.graph, (proxy) => {
					const { [nodeId]: _removedPosition, ...remainingPositions } = proxy.positions;

					proxy.positions = remainingPositions;
				});
			},
		});
	}

	function addEdge(from: string, to: string): void {
		const edge: GraphEdge = { from, to };

		mutateDefinition((definition) => ({
			...definition,
			edges: [...definition.edges, edge],
		}));

		pushHistory({
			label: `Connect ${from} to ${to}`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					edges: definition.edges.filter((edge) => !(edge.from === from && edge.to === to)),
				}));
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					edges: [...definition.edges, edge],
				}));
			},
		});
	}

	function removeEdge(from: string, to: string): void {
		mutateDefinition((definition) => ({
			...definition,
			edges: definition.edges.filter((edge) => !(edge.from === from && edge.to === to)),
		}));

		pushHistory({
			label: `Disconnect ${from} from ${to}`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					edges: [...definition.edges, { from, to }],
				}));
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					edges: definition.edges.filter((edge) => !(edge.from === from && edge.to === to)),
				}));
			},
		});
	}

	function insertNodeOnEdge(edge: GraphEdge, packageName: string, nodeName: string): void {
		const id = crypto.randomUUID();

		const node: GraphNode = {
			id,
			packageName,
			nodeName,
			parameters: {},
		};

		const fromPosition = context.graph.positions[edge.from];
		const toPosition = context.graph.positions[edge.to];

		const position: Position = fromPosition && toPosition ? { x: (fromPosition.x + toPosition.x) / 2, y: (fromPosition.y + toPosition.y) / 2 } : { x: 0, y: 0 };

		mutateDefinition((definition) => ({
			...definition,
			nodes: [...definition.nodes, node],
			edges: [...definition.edges.filter((graphEdge) => !(graphEdge.from === edge.from && graphEdge.to === edge.to)), { from: edge.from, to: id }, { from: id, to: edge.to }],
		}));

		context.graphStore.mutate(context.graph, (proxy) => {
			proxy.positions[id] = { x: position.x, y: position.y };
		});

		pushHistory({
			label: `Insert ${nodeName} on edge`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.filter((node) => node.id !== id),
					edges: [
						...definition.edges.filter((graphEdge) => !(graphEdge.from === edge.from && graphEdge.to === id) && !(graphEdge.from === id && graphEdge.to === edge.to)),
						{ from: edge.from, to: edge.to },
					],
				}));
				context.graphStore.mutate(context.graph, (proxy) => {
					const { [id]: _removedPosition, ...remainingPositions } = proxy.positions;

					proxy.positions = remainingPositions;
				});
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: [...definition.nodes, node],
					edges: [...definition.edges.filter((graphEdge) => !(graphEdge.from === edge.from && graphEdge.to === edge.to)), { from: edge.from, to: id }, { from: id, to: edge.to }],
				}));
				context.graphStore.mutate(context.graph, (proxy) => {
					proxy.positions[id] = { x: position.x, y: position.y };
				});
			},
		});
	}

	function toggleBypass(nodeId: string): void {
		const currentNode = graphDefinition.nodes.find((node) => node.id === nodeId);
		const wasBypassed = currentNode?.options?.bypass ?? false;

		mutateDefinition((definition) => ({
			...definition,
			nodes: definition.nodes.map((node) => (node.id === nodeId ? { ...node, options: { ...node.options, bypass: !wasBypassed } } : node)),
		}));

		pushHistory({
			label: `${wasBypassed ? "Enable" : "Bypass"} node`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.map((node) => (node.id === nodeId ? { ...node, options: { ...node.options, bypass: wasBypassed } } : node)),
				}));
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.map((node) => (node.id === nodeId ? { ...node, options: { ...node.options, bypass: !wasBypassed } } : node)),
				}));
			},
		});
	}

	function setGraphName(name: string): void {
		const previousName = graphDefinition.name;

		mutateDefinition((definition) => ({
			...definition,
			name,
		}));

		pushHistory({
			label: `Rename graph to "${name}"`,
			undo: () => {
				mutateDefinition((definition) => ({
					...definition,
					name: previousName,
				}));
			},
			redo: () => {
				mutateDefinition((definition) => ({
					...definition,
					name,
				}));
			},
		});
	}

	function updateNodeParameters(nodeId: string, parameterName: string, value: unknown): void {
		const currentNode = graphDefinition.nodes.find((node) => node.id === nodeId);
		const previousValue = currentNode?.parameters?.[parameterName];

		mutateDefinition((definition) => ({
			...definition,
			nodes: definition.nodes.map((node) =>
				node.id === nodeId
					? { ...node, parameters: { ...node.parameters, [parameterName]: value } }
					: node,
			),
		}));

		pushHistory({
			label: `Change ${parameterName}`,
			undo: () =>
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.map((node) =>
						node.id === nodeId
							? { ...node, parameters: { ...node.parameters, [parameterName]: previousValue } }
							: node,
					),
				})),
			redo: () =>
				mutateDefinition((definition) => ({
					...definition,
					nodes: definition.nodes.map((node) =>
						node.id === nodeId
							? { ...node, parameters: { ...node.parameters, [parameterName]: value } }
							: node,
					),
				})),
		});
	}

	return {
		addNode,
		removeNode,
		addEdge,
		removeEdge,
		insertNodeOnEdge,
		toggleBypass,
		setGraphName,
		updateNodeParameters,
	};
}
