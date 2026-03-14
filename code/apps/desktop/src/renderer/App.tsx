import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { AppState } from "./models/State/App";
import { loadAppState, useAppState } from "./models/State/App";
import type { JobsState } from "./models/State/Jobs";
import { useJobsState } from "./models/State/Jobs";
import { Logger } from "../shared/models/Logger/Logger";

export const App: React.FC = () => {
	const logger = useMemo(() => {
		const logger = new Logger("renderer");
		Logger.level = "debug";
		return logger;
	}, []);

	const queryClient = useMemo(() => new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				refetchOnWindowFocus: false,
			},
		},
	}), []);

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

	if (!initialState || !windowId || !userDataPath) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="animate-pulse text-muted-foreground">Loading...</div>
			</div>
		);
	}

	return (
		<AppInner
			initialState={initialState}
			appStore={appStore}
			main={mainWithEvents}
			windowId={windowId}
			userDataPath={userDataPath}
			logger={logger}
			queryClient={queryClient}
		/>
	);
};

interface AppInnerProps {
	readonly initialState: Omit<AppState, "_key">;
	readonly appStore: ProxyStore;
	readonly main: MainWithEvents;
	readonly windowId: string;
	readonly userDataPath: string;
	readonly logger: Logger;
	readonly queryClient: QueryClient;
}

const AppInner: React.FC<AppInnerProps> = ({ initialState, appStore, main: mainWithEvents, windowId, userDataPath, logger, queryClient }) => {
	const app = useAppState(initialState, appStore);
	const jobs = useCreateState<JobsState>({ jobs: new Map() }, appStore);

	useJobsState(appStore, jobs);
	useWindowState(app, appStore, mainWithEvents);
	useAutosave(app, appStore, mainWithEvents, userDataPath);

	const context = useMemo(
		(): AppContext => ({ app, appStore, jobs, logger, main: mainWithEvents, queryClient, userDataPath, windowId }),
		[app, appStore, jobs, logger, mainWithEvents, queryClient, userDataPath, windowId],
	);

	const packagesInitialized = useRef(false);

	useEffect(() => {
		if (packagesInitialized.current) return;

		packagesInitialized.current = true;
		void initializeAllPackages(context);
	}, [context]);

	const handleRetryPackage = useCallback(
		(index: number) => {
			const config = context.app.packageUrls[index];
			if (!config) return;
			void initializePackage(config, index, context);
		},
		[context],
	);

	const [userContinued, setUserContinued] = useState(false);

	const allPackagesDone = context.app.packages.length === 0 || context.app.packages.every((entry) => entry.status === "ready" || entry.status === "skipped" || entry.status === "error");
	const hasPackageErrors = context.app.packages.some((entry) => entry.status === "error");
	const packagesReady = allPackagesDone && (!hasPackageErrors || userContinued);

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider context={context}>
				<ErrorBoundary>
					{packagesReady ? (
						<Layout context={context} />
					) : (
						<LoadingScreen
							context={context}
							onRetry={handleRetryPackage}
							onContinue={() => setUserContinued(true)}
						/>
					)}
				</ErrorBoundary>
			</ThemeProvider>
		</QueryClientProvider>
	);
};
