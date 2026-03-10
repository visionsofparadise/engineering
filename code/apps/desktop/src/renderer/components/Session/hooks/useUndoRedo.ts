import { useCallback, useMemo } from "react";
import type { SessionContext } from "../../../models/Context";

export function useUndoRedo(context: SessionContext, snapshots: ReadonlyArray<string>) {
	const tab = context.app.tabs.find((entry) => entry.workingDir === context.sessionPath);
	const activeFolder = tab?.activeSnapshotFolder;

	const currentIndex = useMemo(() => {
		if (!activeFolder) return snapshots.length - 1;
		const index = snapshots.indexOf(activeFolder);
		return index >= 0 ? index : snapshots.length - 1;
	}, [activeFolder, snapshots]);

	const setActiveFolder = useCallback(
		(folder: string | undefined) => {
			context.appStore.mutate(context.app, (proxy) => {
				const proxyTab = proxy.tabs.find((entry) => entry.workingDir === context.sessionPath);
				if (proxyTab) {
					proxyTab.activeSnapshotFolder = folder;
				}
			});
		},
		[context],
	);

	const undo = useCallback(() => {
		if (currentIndex <= 0) return;
		setActiveFolder(snapshots[currentIndex - 1]);
	}, [currentIndex, snapshots, setActiveFolder]);

	const redo = useCallback(() => {
		if (currentIndex >= snapshots.length - 1) return;
		const nextIndex = currentIndex + 1;
		setActiveFolder(nextIndex === snapshots.length - 1 ? undefined : snapshots[nextIndex]);
	}, [currentIndex, snapshots, setActiveFolder]);

	return {
		undo,
		redo,
		canUndo: currentIndex > 0,
		canRedo: currentIndex < snapshots.length - 1,
	};
}
