import type { GraphDefinition } from "@e9g/buffered-audio-nodes-core";
import { useEffect, useMemo } from "react";
import { useGraphState } from "../../../hooks/useGraphState";
import { useHistory } from "../../../hooks/useHistory";
import type { AppContext, GraphContext } from "../../../models/Context";
import { ProxyStore } from "../../../models/ProxyStore/ProxyStore";
import type { TabEntry } from "../../../models/State/App";
import type { GraphState } from "../../../models/State/Graph";
import { ReactFlowProvider } from "@xyflow/react";
import { computeAutoLayout } from "../../../utilities/autoLayout";
import { GraphCanvas } from "./Canvas";
import { SnapshotSession } from "../Spectral/Session";

interface Props {
	readonly initialGraphState: Omit<GraphState, "_key">;
	readonly context: AppContext;
	readonly tab: TabEntry;
	readonly graphDefinition: GraphDefinition;
	readonly mutateDefinition: (updater: (definition: GraphDefinition) => GraphDefinition) => void;
}

export function GraphSession({ initialGraphState, context, tab, graphDefinition, mutateDefinition }: Props) {
	const graphStore = useMemo(() => new ProxyStore(), []);

	// Apply auto-layout to initial state if no positions saved
	const layoutAppliedState = useMemo(() => {
		const needsLayout = Object.keys(initialGraphState.positions).length === 0 && graphDefinition.nodes.length > 0;

		return needsLayout ? { ...initialGraphState, positions: computeAutoLayout(graphDefinition.nodes, graphDefinition.edges) } : initialGraphState;
	}, [initialGraphState, graphDefinition.nodes, graphDefinition.edges]);

	const { graph } = useGraphState(layoutAppliedState, graphStore, tab.id, context);

	const { history, pushHistory, undo, redo } = useHistory(tab.id, context);

	// Sync tab name from graph definition
	useEffect(() => {
		context.tabNames.set(tab.id, graphDefinition.name);
	}, [context.tabNames, tab.id, graphDefinition.name]);

	// Register rename callback so TabBar can rename this graph
	useEffect(() => {
		context.renameCallbacks.set(tab.id, (name: string) => {
			mutateDefinition((definition) => ({
				...definition,
				name,
			}));
		});

		return () => {
			context.renameCallbacks.delete(tab.id);
		};
	}, [context.renameCallbacks, tab.id, mutateDefinition]);

	const graphContext: GraphContext = useMemo(
		() => ({
			...context,
			graph,
			graphStore,
			graphDefinition,
			mutateDefinition,
			bagPath: tab.bagPath,
			bagId: tab.id,
			history,
			pushHistory,
			undo,
			redo,
		}),
		[context, graph, graphStore, graphDefinition, mutateDefinition, tab.bagPath, tab.id, history, pushHistory, undo, redo],
	);

	const { spectralNodeId } = graph;

	if (spectralNodeId !== null) {
		return <SnapshotSession context={graphContext} spectralNodeId={spectralNodeId} />;
	}

	return (
		<ReactFlowProvider>
			<GraphCanvas context={graphContext} />
		</ReactFlowProvider>
	);
}
