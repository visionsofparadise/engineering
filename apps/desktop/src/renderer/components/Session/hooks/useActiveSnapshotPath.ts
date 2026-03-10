import { useMemo } from "react";
import type { SessionContext } from "../../../models/Context";
import { useSnapshots } from "./useSnapshots";

export function useActiveSnapshotPath(context: SessionContext): string {
	const snapshots = useSnapshots(context);
	const tab = context.app.tabs.find((entry) => entry.workingDir === context.sessionPath);
	const activeFolder = tab?.activeSnapshotFolder;

	return useMemo(() => {
		const latestFolder = snapshots[snapshots.length - 1];

		if (!activeFolder) {
			return latestFolder ? `${context.sessionPath}/${latestFolder}` : "";
		}

		const match = snapshots.find((folder) => folder === activeFolder);
		if (match) return `${context.sessionPath}/${match}`;

		return latestFolder ? `${context.sessionPath}/${latestFolder}` : "";
	}, [snapshots, activeFolder, context.sessionPath]);
}
