import { useMemo } from "react";
import type { SessionContext } from "../../../models/Context";

export function useMonitoredSnapshotPath(context: SessionContext): string {
	const { graph, userDataPath } = context;
	const monitoredNodeId = graph.sessionState.monitoredNodeId;

	return useMemo(() => {
		if (!monitoredNodeId) return "";
		const hash = graph.getNodeContentHash(monitoredNodeId);

		if (!hash) return "";

		return `${userDataPath}/snapshots/${hash}`;
	}, [monitoredNodeId, graph, userDataPath]);
}
