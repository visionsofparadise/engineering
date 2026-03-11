import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Logger } from "../shared/models/Logger/Logger";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Layout } from "./components/Layout";
import { LoadingScreen } from "./components/LoadingScreen";
import { initializeAllPackages, initializePackage } from "./components/ModuleManager/utils/initializePackages";
import { ThemeProvider } from "./components/ThemeProvider";
import { useAutosave } from "./hooks/useAutosave";
import { useWindowState } from "./hooks/useWindowState";
import type { AppContext } from "./models/Context";
import { main, type MainWithEvents } from "./models/Main";
import { MainEvents } from "./models/MainEvents";
import { useCreateState } from "./models/ProxyStore/hooks/useCreateState";
import { ProxyStore } from "./models/ProxyStore/ProxyStore";
import { loadAppState, useAppState } from "./models/State/App";
import type { JobsState } from "./models/State/Jobs";
import { useJobsState } from "./models/State/Jobs";

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
	const jobs = useCreateState<JobsState>({ jobs: new Map() }, appStore);

	useJobsState(appStore, jobs);
	useWindowState(app, appStore, mainWithEvents);

	const { data: windowId } = useQuery(
		{
			queryKey: ["windowId"],
			queryFn: () => mainWithEvents.getWindowId(),
			staleTime: Infinity,
		},
		queryClient,
	);

	const { data: userDataPath } = useQuery(
		{
			queryKey: ["userDataPath"],
			queryFn: () => mainWithEvents.getUserDataPath(),
			staleTime: Infinity,
		},
		queryClient,
	);

	useAutosave(app, appStore, mainWithEvents, userDataPath);

	const context = useMemo(
		(): AppContext | undefined => (windowId && userDataPath ? { app, appStore, jobs, logger, main: mainWithEvents, queryClient, userDataPath, windowId } : undefined),
		[windowId, userDataPath, app, appStore, jobs, mainWithEvents],
	);

	const packagesInitialized = useRef(false);

	useEffect(() => {
		if (!context || packagesInitialized.current) return;

		packagesInitialized.current = true;
		void initializeAllPackages(context);
	}, [context]);

	const handleSkipPackage = useCallback(
		(index: number) => {
			if (!context) return;

			context.appStore.mutate(context.app, (proxy) => {
				const entry = proxy.packages[index];

				if (entry) entry.status = "skipped";
			});
		},
		[context],
	);

	const handleRetryPackage = useCallback(
		(index: number) => {
			if (!context) return;
			const config = context.app.packageUrls[index];
			if (!config) return;
			void initializePackage(config, index, context);
		},
		[context],
	);

	const packagesReady = context?.app.packages.length === 0 || context?.app.packages.every((entry) => entry.status === "ready" || entry.status === "skipped" || entry.status === "error");

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
					{packagesReady ? (
						<Layout context={context} />
					) : (
						<LoadingScreen
							context={context}
							onSkip={handleSkipPackage}
							onRetry={handleRetryPackage}
						/>
					)}
				</ErrorBoundary>
			</ThemeProvider>
		</QueryClientProvider>
	);
};
