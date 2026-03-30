import { useMemo, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AppTabBar } from "@e9g/design-system";
import { Logger } from "../shared/models/Logger";
import { main } from "./models/Main";
import { ProxyStore } from "./models/ProxyStore/ProxyStore";
import { loadAppState, useAppState, type AppState } from "./models/State/App";
import type { AppContext } from "./models/Context";
import { useAutosave } from "./hooks/useAutosave";
import { useWindowState } from "./hooks/useWindowState";
import { TabContent } from "./components/TabContent";

const logger = new Logger("renderer");

Logger.level = "debug";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

const appStore = new ProxyStore();

function AppInner({
	initialState,
	windowId,
	userDataPath,
}: {
	readonly initialState: Omit<AppState, "_key">;
	readonly windowId: string;
	readonly userDataPath: string;
}) {
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

	// Theme effect
	useEffect(() => {
		if (app.theme === "viridis") {
			document.documentElement.setAttribute("data-theme", "viridis");
		} else {
			document.documentElement.removeAttribute("data-theme");
		}
	}, [app.theme]);

	const tabs = app.tabs.map((tab) => ({
		id: tab.id,
		label: tab.bagPath.split("/").pop() ?? tab.bagPath,
	}));

	return (
		<div className="flex flex-col h-screen">
			<AppTabBar
				tabs={tabs}
				activeTabId={app.activeTabId ?? ""}
				onTabSelect={(id) => {
					appStore.mutate(app, (proxy) => {
						proxy.activeTabId = id;
					});
				}}
				onTabClose={(id) => {
					appStore.mutate(app, (proxy) => {
						const index = proxy.tabs.findIndex((tab) => tab.id === id);

						if (index === -1) return;
						proxy.tabs.splice(index, 1);

						if (proxy.activeTabId === id) {
							proxy.activeTabId = proxy.tabs[index]?.id ?? proxy.tabs[index - 1]?.id ?? null;
						}
					});
				}}
				onNewTab={() => {
					// stub — no-op for now
				}}
			/>
			<TabContent context={context} />
		</div>
	);
}

function AppLoader() {
	const { data: initialState } = useQuery({
		queryKey: ["initialState"],
		queryFn: () => loadAppState(main),
	});

	const { data: windowId } = useQuery({
		queryKey: ["windowId"],
		queryFn: () => main.getWindowId(),
	});

	const { data: userDataPath } = useQuery({
		queryKey: ["userDataPath"],
		queryFn: () => main.getUserDataPath(),
	});

	if (!initialState || !windowId || !userDataPath) {
		return (
			<div className="flex h-screen items-center justify-center bg-chrome-base">
				<div className="text-chrome-text-secondary font-technical uppercase tracking-[0.06em]">Loading...</div>
			</div>
		);
	}

	return <AppInner initialState={initialState} windowId={windowId} userDataPath={userDataPath} />;
}

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<AppLoader />
		</QueryClientProvider>
	);
}
