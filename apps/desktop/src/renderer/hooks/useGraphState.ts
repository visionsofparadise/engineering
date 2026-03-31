import { useEffect } from "react";
import { snapshot, subscribe, type Snapshot } from "valtio/vanilla";
import type { AppContext } from "../models/Context";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useCreateState } from "../models/ProxyStore/hooks/useCreateState";
import { serializeGraphState, type GraphState } from "../models/State/Graph";

interface UseGraphStateResult {
	readonly graph: Snapshot<GraphState>;
}

export function useGraphState(
	initialState: Omit<GraphState, "_key">,
	store: ProxyStore,
	bagId: string,
	context: AppContext,
): UseGraphStateResult {
	const { main, userDataPath } = context;
	const graph = useCreateState<GraphState>(initialState, store);

	useEffect(() => {
		const proxy = store.dangerouslyGetProxy<GraphState>(graph._key);

		if (!proxy) return;

		const unsubscribe = subscribe(proxy, () => {
			const data = serializeGraphState(snapshot(proxy));

			void main.writeFile(`${userDataPath}/graphs/${bagId}.json`, data);
		});

		return unsubscribe;
	}, [graph._key, store, main, userDataPath, bagId]);

	return { graph };
}
