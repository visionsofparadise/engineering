import type { QueryClient } from "@tanstack/react-query";
import type { Snapshot } from "valtio/vanilla";
import type { Logger } from "../../shared/models/Logger";
import type { Main } from "./Main";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { AppState } from "./State/App";

export interface HistoryEntry {
	label: string;
	undo: () => void;
	redo: () => void;
}

export interface AppContext {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly logger: Logger;
	readonly main: Main;
	readonly queryClient: QueryClient;
	readonly userDataPath: string;
	readonly windowId: string;
	readonly historyStacks: Map<string, { undo: Array<HistoryEntry>; redo: Array<HistoryEntry> }>;
}
