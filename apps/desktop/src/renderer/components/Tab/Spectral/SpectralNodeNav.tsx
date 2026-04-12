import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { IconButton } from "@e9g/design-system";
import type { SnapshotContext } from "../../../models/Context";
import { topologicalSort } from "../../../../shared/utilities/topologicalSort";

interface Props {
	readonly context: SnapshotContext;
}

export function SpectralNodeNav({ context }: Props) {
	const { graphDefinition, graph, graphStore, main, userDataPath, bagId } = context;
	const spectralNodeId = graph.spectralNodeId;

	// Flatten topological layers into a single ordered list of node IDs
	const topologicalOrder = useMemo(() => {
		try {
			const layers = topologicalSort(graphDefinition.nodes, graphDefinition.edges);

			return layers.flat();
		} catch {
			return graphDefinition.nodes.map((node) => node.id);
		}
	}, [graphDefinition.nodes, graphDefinition.edges]);

	// Build node ID -> name lookup
	const nodeNames = useMemo(() => {
		const map = new Map<string, string>();

		for (const node of graphDefinition.nodes) {
			map.set(node.id, node.nodeName);
		}

		return map;
	}, [graphDefinition.nodes]);

	// Determine which nodes have snapshots (async check on mount / when graph changes)
	const [nodesWithSnapshots, setNodesWithSnapshots] = useState<Set<string>>(() => new Set());

	const checkSnapshots = useCallback(async () => {
		const checks = await Promise.all(
			topologicalOrder.map(async (nodeId): Promise<[string, boolean]> => {
				const snapshotDir = `${userDataPath}/snapshots/${bagId}/${nodeId}/`;

				try {
					const entries = await main.readDirectory(snapshotDir);

					return [nodeId, entries.length > 0];
				} catch {
					return [nodeId, false];
				}
			}),
		);

		const withSnapshots = new Set<string>();

		for (const [nodeId, hasSnapshot] of checks) {
			if (hasSnapshot) {
				withSnapshots.add(nodeId);
			}
		}

		setNodesWithSnapshots(withSnapshots);
	}, [topologicalOrder, userDataPath, bagId, main]);

	useEffect(() => {
		void checkSnapshots();
	}, [checkSnapshots]);

	// Filter to nodes with snapshots, maintaining topological order
	const navigableNodes = useMemo(
		() => topologicalOrder.filter((nodeId) => nodesWithSnapshots.has(nodeId)),
		[topologicalOrder, nodesWithSnapshots],
	);

	const currentIndex = spectralNodeId !== null ? navigableNodes.indexOf(spectralNodeId) : -1;
	const previousNode = currentIndex > 0 ? navigableNodes[currentIndex - 1] : undefined;
	const nextNode = currentIndex < navigableNodes.length - 1 ? navigableNodes[currentIndex + 1] : undefined;

	const navigateTo = useCallback(
		(nodeId: string | undefined) => {
			if (nodeId === undefined) return;

			graphStore.mutate(graph, (proxy) => {
				proxy.spectralNodeId = nodeId;
			});
		},
		[graphStore, graph],
	);

	const backToGraph = useCallback(() => {
		graphStore.mutate(graph, (proxy) => {
			proxy.spectralNodeId = null;
		});
	}, [graphStore, graph]);

	const currentName = spectralNodeId !== null ? (nodeNames.get(spectralNodeId) ?? "") : "";
	const previousName = previousNode !== undefined ? (nodeNames.get(previousNode) ?? "") : undefined;
	const nextName = nextNode !== undefined ? (nodeNames.get(nextNode) ?? "") : undefined;

	return (
		<div className="flex h-8 shrink-0 items-center bg-void px-3">
			<IconButton
				icon="lucide:layout-grid"
				label="Back to graph"
				size={16}
				variant="ghost"
				onClick={backToGraph}
			/>

			<div className="ml-3 flex items-center gap-2">
				<button
					type="button"
					className="flex h-8 items-center gap-1 font-body text-[length:var(--text-sm)] text-chrome-text-secondary hover:text-chrome-text disabled:opacity-40 disabled:hover:text-chrome-text-secondary"
					aria-label={previousName !== undefined ? `Go to ${previousName}` : "No previous node"}
					disabled={previousNode === undefined}
					onClick={() => navigateTo(previousNode)}
				>
					<Icon icon="lucide:chevron-left" width={14} height={14} />
					{previousName !== undefined && <span>{previousName}</span>}
				</button>

				<span className="font-body text-[length:var(--text-base)] font-medium text-chrome-text">
					{currentName}
				</span>

				<button
					type="button"
					className="flex h-8 items-center gap-1 font-body text-[length:var(--text-sm)] text-chrome-text-secondary hover:text-chrome-text disabled:opacity-40 disabled:hover:text-chrome-text-secondary"
					aria-label={nextName !== undefined ? `Go to ${nextName}` : "No next node"}
					disabled={nextNode === undefined}
					onClick={() => navigateTo(nextNode)}
				>
					{nextName !== undefined && <span>{nextName}</span>}
					<Icon icon="lucide:chevron-right" width={14} height={14} />
				</button>
			</div>

			<div className="ml-auto">
				<IconButton
					icon="lucide:settings"
					label="Settings"
					size={16}
					variant="ghost"
				/>
			</div>
		</div>
	);
}
