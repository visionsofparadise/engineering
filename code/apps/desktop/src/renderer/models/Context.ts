import type { QueryClient } from "@tanstack/react-query";
import type { Snapshot } from "valtio/vanilla";
import type { Logger } from "../../shared/models/Logger/Logger";
import type { MainWithEvents } from "./Main";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { AppState } from "./State/App";

export interface AppContext {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly logger: Logger;
	readonly main: MainWithEvents;
	readonly queryClient: QueryClient;
	readonly windowId: string;
}

export interface SessionContext extends AppContext {
	readonly sessionPath: string;
}
