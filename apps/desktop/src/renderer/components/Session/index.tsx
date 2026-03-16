import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useChain } from "../../hooks/useChain";
import { useSessionKeyboard } from "./hooks/useSessionKeyboard";
import { useUndoRedo } from "./hooks/useUndoRedo";
import type { AppContext, SessionContext } from "../../models/Context";
import { PlaybackEngine } from "../../models/PlaybackEngine";
import { ProxyStore } from "../../models/ProxyStore/ProxyStore";
import type { TabEntry } from "../../models/State/App";
import { usePlaybackState } from "../../models/State/Playback";
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

	const { chain, save: saveChain } = useChain(sessionPath);

	const workspace = useWorkspaceState(sessionStore);
	const selection = useSelectionState(sessionStore);
	const playback = usePlaybackState(sessionStore);

	const playbackRef = useRef(playback);
	playbackRef.current = playback;
	const selectionRef = useRef(selection);
	selectionRef.current = selection;

	const playbackEngineRef = useRef<PlaybackEngine | null>(null);
	playbackEngineRef.current ??= new PlaybackEngine(sessionStore, playbackRef, selectionRef);
	const playbackEngine = playbackEngineRef.current;

	useEffect(() => () => playbackEngine.dispose(), [playbackEngine]);

	const sessionContext = useMemo((): SessionContext | undefined => {
		if (!chain || !snapshots.data?.length) return undefined;

		return {
			...context,
			sessionPath,
			chain,
			saveChain,
			sessionStore,
			workspace,
			selection,
			playback,
			playbackEngine,
		};
	}, [context, sessionPath, chain, saveChain, snapshots.data, sessionStore, workspace, selection, playback, playbackEngine]);

	const snapshotList = snapshots.data ?? [];
	const activeSnapshotFolder = tab.activeSnapshotFolder ?? snapshotList[snapshotList.length - 1];

	useEffect(() => {
		if (activeSnapshotFolder) {
			playbackEngine.load(`${sessionPath}/${activeSnapshotFolder}/audio.wav`);
		}
	}, [activeSnapshotFolder, sessionPath, playbackEngine]);

	const { undo, redo } = useUndoRedo(
		sessionContext ?? { ...context, sessionPath, chain: { transforms: [] }, saveChain, sessionStore, workspace, selection, playback, playbackEngine },
		snapshotList,
	);

	useSessionKeyboard({ undo, redo, isPlaying: playback.isPlaying, playbackEngine });

	if (!sessionContext) {
		return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
	}

	return <SessionLayout context={sessionContext} />;
};
