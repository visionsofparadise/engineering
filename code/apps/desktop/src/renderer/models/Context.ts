import type { ChainDefinition } from "@engineering/acm";
import type { QueryClient } from "@tanstack/react-query";
import type { Snapshot } from "valtio/vanilla";
import type { Logger } from "../../shared/models/Logger/Logger";
import type { MainWithEvents } from "./Main";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { AppState } from "./State/App";
import type { SelectionState } from "./State/Selection";
import type { WorkspaceState } from "./State/Workspace";

export interface AppContext {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly logger: Logger;
	readonly main: MainWithEvents;
	readonly queryClient: QueryClient;
	readonly userDataPath: string;
	readonly windowId: string;
}

export interface SessionContext extends AppContext {
	readonly sessionPath: string;
	readonly chain: ChainDefinition;
	readonly sessionStore: ProxyStore;
	readonly workspace: Snapshot<WorkspaceState>;
	readonly selection: Snapshot<SelectionState>;
}
