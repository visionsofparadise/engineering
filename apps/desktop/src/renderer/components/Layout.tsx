import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Logger } from "../../shared/models/Logger";
import { useAutosave } from "../hooks/useAutosave";
import { usePackageLoader } from "../hooks/usePackageLoader";
import { useWindowState } from "../hooks/useWindowState";
import type { AppContext } from "../models/Context";
import { main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useAppState, type AppState } from "../models/State/App";
import { LoadingScreen } from "./LoadingScreen";
import { BinaryManager } from "./BinaryManager";
import { ModuleManager } from "./ModuleManager";
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

	const { isLoading } = usePackageLoader(app, appStore, main, userDataPath);
	const [hasPassedLoading, setHasPassedLoading] = useState(false);
	const [moduleManagerOpen, setModuleManagerOpen] = useState(false);
	const [binaryManagerOpen, setBinaryManagerOpen] = useState(false);

	const openModuleManager = useCallback(() => setModuleManagerOpen(true), []);
	const closeModuleManager = useCallback(() => setModuleManagerOpen(false), []);
	const openBinaryManager = useCallback(() => setBinaryManagerOpen(true), []);
	const closeBinaryManager = useCallback(() => setBinaryManagerOpen(false), []);

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

	if (!hasPassedLoading) {
		return (
			<LoadingScreen
				packages={app.packages}
				isLoading={isLoading}
				onContinue={() => setHasPassedLoading(true)}
			/>
		);
	}

	return (
		<div className="flex flex-col h-screen">
			<AppTabBar context={context} onOpenModuleManager={openModuleManager} onOpenBinaryManager={openBinaryManager} />
			<TabContent context={context} />
			<ModuleManager context={context} isOpen={moduleManagerOpen} onClose={closeModuleManager} />
			<BinaryManager context={context} isOpen={binaryManagerOpen} onClose={closeBinaryManager} />
		</div>
	);
};
