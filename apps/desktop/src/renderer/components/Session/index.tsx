import { useEffect, useMemo, useRef } from "react";
import { useGraph } from "../../hooks/useGraph";
import { useSessionKeyboard } from "./hooks/useSessionKeyboard";
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
	const bagPath = tab.filePath;
	const sessionStore = useMemo(() => new ProxyStore(), []);

	const graph = useGraph(bagPath, context.userDataPath, context.app.packages);

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
		if (!graph.graphDefinition) return undefined;

		return {
			...context,
			bagPath,
			graph,
			sessionStore,
			workspace,
			selection,
			playback,
			playbackEngine,
		};
	}, [context, bagPath, graph, sessionStore, workspace, selection, playback, playbackEngine]);

	useEffect(() => {
		const monitoredNodeId = graph.sessionState.monitoredNodeId;

		if (!monitoredNodeId) {
			playbackEngine.stop();

			return;
		}

		const paths = graph.getNodeSnapshotPaths(monitoredNodeId);

		if (paths) {
			playbackEngine.load(paths.audio);
		}
	}, [graph.sessionState.monitoredNodeId, graph.getNodeSnapshotPaths, playbackEngine]);

	useSessionKeyboard({ undo: graph.undo, redo: graph.redo, isPlaying: playback.isPlaying, playbackEngine, graph, selection });

	if (!sessionContext) {
		return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
	}

	return <SessionLayout context={sessionContext} />;
};
