import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChain } from "../../hooks/useChain";
import { useUndoRedo } from "./hooks/useUndoRedo";
import type { AppContext, SessionContext } from "../../models/Context";
import { ProxyStore } from "../../models/ProxyStore/ProxyStore";
import type { TabEntry } from "../../models/State/App";
import { useSelectionState } from "../../models/State/Selection";
import { useWorkspaceState } from "../../models/State/Workspace";
import { SessionLayout } from "./Layout";

interface SessionProps {
	tab: TabEntry;
	context: AppContext;
}

export const Session: React.FC<SessionProps> = ({ tab, context }) => {
	const sessionPath = tab.workingDir;
	const sessionStore = useMemo(() => new ProxyStore(), []);

	const snapshots = useQuery({
		queryKey: ["snapshots", sessionPath],
		queryFn: async () => {
			const entries = await window.main.readDirectory(sessionPath);
			return entries.filter((entry) => entry !== "chain.json").sort();
		},
	});

	const chain = useChain(sessionPath);

	const workspace = useWorkspaceState(sessionStore);
	const selection = useSelectionState(sessionStore);

	const sessionContext = useMemo((): SessionContext | undefined => {
		if (!chain || !snapshots.data?.length) return undefined;

		return {
			...context,
			sessionPath,
			chain,
			sessionStore,
			workspace,
			selection,
		};
	}, [context, sessionPath, chain, snapshots.data, sessionStore, workspace, selection]);

	const snapshotList = snapshots.data ?? [];
	const { undo, redo } = useUndoRedo(
		sessionContext ?? { ...context, sessionPath, chain: { transforms: [] }, sessionStore, workspace, selection },
		snapshotList,
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "z") {
				event.preventDefault();
				if (event.shiftKey) {
					redo();
				} else {
					undo();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [undo, redo]);

	if (!sessionContext) {
		return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
	}

	return <SessionLayout context={sessionContext} />;
};
