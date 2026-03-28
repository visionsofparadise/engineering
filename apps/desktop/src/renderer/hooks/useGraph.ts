import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { validateGraphDefinition, type GraphDefinition, type GraphNode, type GraphEdge } from "@e9g/buffered-audio-nodes-core";
import type { NodeRenderState, SessionState } from "../../shared/models/Session";
import { contentHash } from "../../shared/utilities/contentHash";
import { hasSnapshot, getSnapshotPaths } from "../../shared/utilities/snapshots";
import { loadSessionState, saveSessionState } from "../../shared/utilities/sessionState";
import { getPackageVersion } from "../../shared/utilities/packageVersion";

interface UndoEntry {
	readonly before: GraphDefinition;
	readonly after: GraphDefinition;
}

const DEFAULT_SESSION_STATE: SessionState = {
	positions: {},
	monitoredNodeId: null,
	viewport: { x: 0, y: 0, zoom: 1 },
};

function computeContentHashes(
	graphDefinition: GraphDefinition,
	packages: ReadonlyArray<{ name?: string; version?: string }>,
): Map<string, string> {
	const hashes = new Map<string, string>();
	const incomingEdge = new Map<string, string>();

	for (const edge of graphDefinition.edges) {
		incomingEdge.set(edge.to, edge.from);
	}

	const compute = (nodeId: string): string => {
		const cached = hashes.get(nodeId);

		if (cached !== undefined) return cached;

		const node = graphDefinition.nodes.find((n) => n.id === nodeId);

		if (!node) throw new Error(`Node "${nodeId}" not found in graph definition`);

		const parentId = incomingEdge.get(nodeId);
		const upstreamHash = parentId !== undefined ? compute(parentId) : "";
		const version = getPackageVersion(packages, node.packageName);
		const hash = contentHash(upstreamHash, node.packageName, version, node.nodeName, node.parameters ?? {}, node.options?.bypass ?? false);

		hashes.set(nodeId, hash);

		return hash;
	};

	for (const node of graphDefinition.nodes) {
		compute(node.id);
	}

	return hashes;
}

async function computeNodeStates(
	graphDefinition: GraphDefinition,
	hashes: Map<string, string>,
	userDataPath: string,
): Promise<Map<string, NodeRenderState>> {
	const states = new Map<string, NodeRenderState>();

	await Promise.all(
		graphDefinition.nodes.map(async (node) => {
			if (node.options?.bypass) {
				states.set(node.id, "bypassed");

				return;
			}

			const hash = hashes.get(node.id);

			if (hash && (await hasSnapshot(userDataPath, hash))) {
				states.set(node.id, "applied");
			} else {
				states.set(node.id, "stale");
			}
		}),
	);

	return states;
}

export function useGraph(
	bagPath: string,
	userDataPath: string,
	packages: ReadonlyArray<{ name?: string; version?: string }>,
) {
	const query = useQuery({
		queryKey: ["graph", bagPath],
		queryFn: async () => {
			const content = await window.main.readFile(bagPath);
			const graphDefinition = validateGraphDefinition(JSON.parse(content));
			const sessionState = await loadSessionState(userDataPath, bagPath);

			return { graphDefinition, sessionState };
		},
		staleTime: Infinity,
	});

	const [graphDefinition, setGraphDefinition] = useState<GraphDefinition | undefined>(query.data?.graphDefinition);
	const [sessionState, setSessionState] = useState<SessionState>(query.data?.sessionState ?? DEFAULT_SESSION_STATE);
	const [nodeStates, setNodeStates] = useState<Map<string, NodeRenderState>>(new Map());
	const [contentHashes, setContentHashes] = useState<Map<string, string>>(new Map());

	const undoStack = useRef<Array<UndoEntry>>([]);
	const redoStack = useRef<Array<UndoEntry>>([]);
	const [, setUndoRedoVersion] = useState(0);

	useEffect(() => {
		if (query.data) {
			setGraphDefinition(query.data.graphDefinition);
			setSessionState(query.data.sessionState ?? DEFAULT_SESSION_STATE);
		}
	}, [query.data]);

	const recomputeNodeStates = useCallback(async () => {
		if (!graphDefinition) return;

		const hashes = computeContentHashes(graphDefinition, packages);

		setContentHashes(hashes);

		const states = await computeNodeStates(graphDefinition, hashes, userDataPath);

		setNodeStates(states);
	}, [graphDefinition, packages, userDataPath]);

	useEffect(() => {
		void recomputeNodeStates();
	}, [recomputeNodeStates]);

	const persist = useCallback(
		(gd: GraphDefinition, ss: SessionState) => {
			void window.main.writeFile(bagPath, JSON.stringify(gd, null, 2));
			void saveSessionState(userDataPath, bagPath, ss);
		},
		[bagPath, userDataPath],
	);

	const mutateGraph = useCallback(
		(mutate: (current: GraphDefinition) => GraphDefinition) => {
			setGraphDefinition((prev) => {
				if (!prev) return prev;

				const before = prev;
				const after = mutate(before);

				undoStack.current.push({ before, after });
				redoStack.current = [];
				setUndoRedoVersion((v) => v + 1);

				setSessionState((ss) => {
					persist(after, ss);

					return ss;
				});

				return after;
			});
		},
		[persist],
	);

	const addNode = useCallback(
		(node: GraphNode) => {
			mutateGraph((gd) => ({ ...gd, nodes: [...gd.nodes, node] }));
		},
		[mutateGraph],
	);

	const removeNode = useCallback(
		(nodeId: string) => {
			mutateGraph((gd) => ({
				...gd,
				nodes: gd.nodes.filter((n) => n.id !== nodeId),
				edges: gd.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
			}));
		},
		[mutateGraph],
	);

	const addEdge = useCallback(
		(edge: GraphEdge) => {
			mutateGraph((gd) => ({ ...gd, edges: [...gd.edges, edge] }));
		},
		[mutateGraph],
	);

	const removeEdge = useCallback(
		(from: string, to: string) => {
			mutateGraph((gd) => ({
				...gd,
				edges: gd.edges.filter((e) => !(e.from === from && e.to === to)),
			}));
		},
		[mutateGraph],
	);

	const updateNodeParameters = useCallback(
		(nodeId: string, parameters: Record<string, unknown>) => {
			mutateGraph((gd) => ({
				...gd,
				nodes: gd.nodes.map((n) => (n.id === nodeId ? { ...n, parameters } : n)),
			}));
		},
		[mutateGraph],
	);

	const toggleBypass = useCallback(
		(nodeId: string) => {
			mutateGraph((gd) => ({
				...gd,
				nodes: gd.nodes.map((n) => (n.id === nodeId ? { ...n, options: { ...n.options, bypass: !(n.options?.bypass ?? false) } } : n)),
			}));
		},
		[mutateGraph],
	);

	const updatePositions = useCallback(
		(positions: Record<string, { x: number; y: number }>) => {
			setSessionState((prev) => {
				const next = { ...prev, positions: { ...prev.positions, ...positions } };

				if (graphDefinition) persist(graphDefinition, next);

				return next;
			});
		},
		[graphDefinition, persist],
	);

	const updateViewport = useCallback(
		(viewport: { x: number; y: number; zoom: number }) => {
			setSessionState((prev) => {
				const next = { ...prev, viewport };

				if (graphDefinition) persist(graphDefinition, next);

				return next;
			});
		},
		[graphDefinition, persist],
	);

	const setMonitor = useCallback(
		(nodeId: string | null) => {
			if (!graphDefinition) return;

			setSessionState((prev) => {
				const next = { ...prev, monitoredNodeId: nodeId };

				persist(graphDefinition, next);

				return next;
			});
		},
		[graphDefinition, persist],
	);

	const insertNodeAfter = useCallback(
		(afterNodeId: string, newNode: GraphNode) => {
			mutateGraph((gd) => {
				const childEdges = gd.edges.filter((e) => e.from === afterNodeId);
				const remainingEdges = gd.edges.filter((e) => e.from !== afterNodeId);

				const newEdges = [
					...remainingEdges,
					{ from: afterNodeId, to: newNode.id },
					...childEdges.map((e) => ({ from: newNode.id, to: e.to })),
				];

				return {
					...gd,
					nodes: [...gd.nodes, newNode],
					edges: newEdges,
				};
			});
		},
		[mutateGraph],
	);

	const setGraphName = useCallback(
		(name: string) => {
			mutateGraph((gd) => ({ ...gd, name }));
		},
		[mutateGraph],
	);

	const undo = useCallback(() => {
		const entry = undoStack.current.pop();

		if (!entry) return;

		redoStack.current.push(entry);
		setUndoRedoVersion((v) => v + 1);
		setGraphDefinition(entry.before);

		setSessionState((ss) => {
			persist(entry.before, ss);

			return ss;
		});
	}, [persist]);

	const redo = useCallback(() => {
		const entry = redoStack.current.pop();

		if (!entry) return;

		undoStack.current.push(entry);
		setUndoRedoVersion((v) => v + 1);
		setGraphDefinition(entry.after);

		setSessionState((ss) => {
			persist(entry.after, ss);

			return ss;
		});
	}, [persist]);

	const getNodeContentHash = useCallback(
		(nodeId: string): string | undefined => contentHashes.get(nodeId),
		[contentHashes],
	);

	const getNodeSnapshotPaths = useCallback(
		(nodeId: string): { audio: string; waveform: string; spectrogram: string } | undefined => {
			const hash = contentHashes.get(nodeId);

			if (!hash) return undefined;

			return getSnapshotPaths(userDataPath, hash);
		},
		[contentHashes, userDataPath],
	);

	const updateNodeState = useCallback((nodeId: string, state: NodeRenderState) => {
		setNodeStates((prev) => {
			const next = new Map(prev);

			next.set(nodeId, state);

			return next;
		});
	}, []);

	return {
		graphDefinition,
		sessionState,
		nodeStates,
		contentHashes,
		addNode,
		removeNode,
		addEdge,
		removeEdge,
		updateNodeParameters,
		toggleBypass,
		setMonitor,
		updatePositions,
		updateViewport,
		insertNodeAfter,
		setGraphName,
		undo,
		redo,
		canUndo: undoStack.current.length > 0,
		canRedo: redoStack.current.length > 0,
		getNodeContentHash,
		getNodeSnapshotPaths,
		updateNodeState,
		recomputeNodeStates,
		isLoading: query.isLoading,
	};
}
