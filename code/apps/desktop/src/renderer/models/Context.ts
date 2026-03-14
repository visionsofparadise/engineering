import type { IdentifiedChain } from "../hooks/useChain";
import type { QueryClient } from "@tanstack/react-query";
import type { Snapshot } from "valtio/vanilla";
import type { Logger } from "../../shared/models/Logger/Logger";
import type { MainWithEvents } from "./Main";
import type { PlaybackEngine } from "./PlaybackEngine";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { AppState } from "./State/App";
import type { JobsState } from "./State/Jobs";
import type { PlaybackState } from "./State/Playback";
import type { SelectionState } from "./State/Selection";
import type { WorkspaceState } from "./State/Workspace";

export interface AppContext {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly jobs: Snapshot<JobsState>;
	readonly logger: Logger;
	readonly main: MainWithEvents;
	readonly queryClient: QueryClient;
	readonly userDataPath: string;
	readonly windowId: string;
}

export interface SessionContext extends AppContext {
	readonly sessionPath: string;
	readonly chain: IdentifiedChain;
	readonly saveChain: (chain: IdentifiedChain) => void;
	readonly sessionStore: ProxyStore;
	readonly workspace: Snapshot<WorkspaceState>;
	readonly selection: Snapshot<SelectionState>;
	readonly playback: Snapshot<PlaybackState>;
	readonly playbackEngine: PlaybackEngine;
}
