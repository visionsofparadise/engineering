import { useEffect, useState } from "react";
import { useGraphDefinition } from "../../../hooks/useGraphDefinition";
import type { AppContext } from "../../../models/Context";
import type { TabEntry } from "../../../models/State/App";
import type { GraphState } from "../../../models/State/Graph";
import { loadGraphState } from "../../../models/State/Graph";
import { GraphSession } from "./Session";

interface Props {
	readonly context: AppContext;
	readonly tab: TabEntry;
}

export function GraphView({ context, tab }: Props) {
	const [initialGraphState, setInitialGraphState] = useState<Omit<GraphState, "_key"> | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	const { graphDefinition, mutateDefinition, isLoading: definitionLoading, error: definitionError } = useGraphDefinition(tab.bagPath, context);

	// Load GraphState (separate from definition)
	useEffect(() => {
		const state = { cancelled: false };

		void (async () => {
			try {
				const graphState = await loadGraphState(context.main, context.userDataPath, tab.id);

				if (!state.cancelled) {
					setInitialGraphState(graphState);
				}
			} catch (graphStateError: unknown) {
				if (!state.cancelled) {
					setLoadError(graphStateError instanceof Error ? graphStateError.message : String(graphStateError));
				}
			}
		})();

		return () => {
			state.cancelled = true;
		};
	}, [context.main, context.userDataPath, tab.id]);

	if (loadError ?? definitionError) {
		const message = loadError ?? (definitionError instanceof Error ? definitionError.message : String(definitionError));

		return <div className="flex flex-1 items-center justify-center bg-chrome-base text-red-400 font-technical">Failed to load graph: {message}</div>;
	}

	if (!initialGraphState || definitionLoading || !graphDefinition) {
		return <div className="flex flex-1 items-center justify-center bg-chrome-base text-chrome-text-secondary font-technical uppercase tracking-[0.06em]">Loading graph...</div>;
	}

	return (
		<GraphSession
			initialGraphState={initialGraphState}
			context={context}
			tab={tab}
			graphDefinition={graphDefinition}
			mutateDefinition={mutateDefinition}
		/>
	);
}
