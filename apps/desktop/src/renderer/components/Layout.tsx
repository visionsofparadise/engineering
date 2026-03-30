import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { Logger } from "../../shared/models/Logger";
import { useAutosave } from "../hooks/useAutosave";
import { useWindowState } from "../hooks/useWindowState";
import type { AppContext } from "../models/Context";
import { main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useAppState, type AppState } from "../models/State/App";
import { AppTabBar } from "./TabBar";
import { TabContent } from "./TabContent";

interface Props {
	readonly initialState: Omit<AppState, "_key">;
	readonly windowId: string;
	readonly userDataPath: string;
	readonly appStore: ProxyStore;
	readonly queryClient: QueryClient;
	readonly logger: Logger;
}

export const AppLayout: React.FC<Props> = ({ initialState, windowId, userDataPath, appStore, queryClient, logger }) => {
	const app = useAppState(initialState, appStore);

	useWindowState(app, appStore, main);
	useAutosave(app, appStore, main, userDataPath);

	const context: AppContext = useMemo(
		() => ({
			app,
			appStore,
			logger,
			main,
			queryClient,
			userDataPath,
			windowId,
			historyStacks: new Map(),
		}),
		[app, windowId, userDataPath],
	);

	useEffect(() => {
		if (app.theme === "viridis") {
			document.documentElement.setAttribute("data-theme", "viridis");
		} else {
			document.documentElement.removeAttribute("data-theme");
		}
	}, [app.theme]);

	return (
		<div className="flex flex-col h-screen">
			<AppTabBar context={context} />
			<TabContent context={context} />
		</div>
	);
};
