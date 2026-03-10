import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Logger } from "../shared/models/Logger/Logger";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { ThemeProvider } from "./components/ThemeProvider";
import { useAutosave } from "./hooks/useAutosave";
import { useWindowState } from "./hooks/useWindowState";
import type { AppContext } from "./models/Context";
import { main, type MainWithEvents } from "./models/Main";
import { MainEvents } from "./models/MainEvents";
import { ProxyStore } from "./models/ProxyStore/ProxyStore";
import { loadAppState, useAppState } from "./models/State/App";

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

export const App: React.FC = () => {
	const appStore = useMemo(() => new ProxyStore(), []);

	const mainWithEvents = useMemo<MainWithEvents>(
		() => ({
			...main,
			events: new MainEvents(main),
		}),
		[],
	);

	const { data: initialState } = useQuery(
		{
			queryKey: ["appState"],
			queryFn: () => loadAppState(mainWithEvents),
			staleTime: Infinity,
		},
		queryClient,
	);

	const app = useAppState(initialState ?? {}, appStore);

	useAutosave(app, appStore, mainWithEvents);
	useWindowState(app, appStore, mainWithEvents);

	const { data: windowId } = useQuery(
		{
			queryKey: ["windowId"],
			queryFn: () => mainWithEvents.getWindowId(),
			staleTime: Infinity,
		},
		queryClient,
	);

	const context = useMemo((): AppContext | undefined => (windowId ? { app, appStore, logger, main: mainWithEvents, queryClient, windowId } : undefined), [windowId, app, appStore, mainWithEvents]);

	if (!context) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="animate-pulse text-muted-foreground">Loading...</div>
			</div>
		);
	}

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider context={context}>
				<ErrorBoundary>
					<Layout context={context} />
				</ErrorBoundary>
			</ThemeProvider>
		</QueryClientProvider>
	);
};
