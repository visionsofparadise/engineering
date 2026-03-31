import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Logger } from "../../shared/models/Logger";
import { useAutosave } from "../hooks/useAutosave";
import { usePackageLoader } from "../hooks/usePackageLoader";
import { useWindowState } from "../hooks/useWindowState";
import type { AppContext, HistoryState } from "../models/Context";
import { main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useAppState, type AppState } from "../models/State/App";
import { loadBag, newBag, openBag } from "../utilities/bagOperations";
import { LoadingScreen } from "./LoadingScreen";
import { BinaryManager } from "./BinaryManager";
import { ModuleManager } from "./ModuleManager";
import { AppTabBar } from "./TabBar";
import { TabContent } from "./Tab";

interface Props {
	readonly initialState: Omit<AppState, "_key">;
	readonly windowId: string;
	readonly userDataPath: string;
	readonly appStore: ProxyStore;
	readonly queryClient: QueryClient;
	readonly logger: Logger;
}

export function AppLayout({ initialState, windowId, userDataPath, appStore, queryClient, logger }: Props) {
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

	const historyStacksRef = useRef(new Map<string, HistoryState>());
	const tabNamesRef = useRef(new Map<string, string>());
	const renameCallbacksRef = useRef(new Map<string, (name: string) => void>());

	const addTab = useCallback(
		(bagId: string, bagPath: string, name: string) => {
			appStore.mutate(app, (proxy) => {
				if (proxy.tabs.some((tab) => tab.id === bagId)) {
					proxy.activeTabId = bagId;

					return;
				}

				proxy.tabs.push({ id: bagId, bagPath });
				proxy.activeTabId = bagId;

				const existing = proxy.recentFiles.filter((rf) => rf.id !== bagId);

				existing.unshift({ id: bagId, bagPath, name, lastOpened: Date.now() });
				proxy.recentFiles = existing.slice(0, 20);
			});

			tabNamesRef.current.set(bagId, name);
		},
		[app, appStore],
	);

	const openBagTab = useCallback(async () => {
		const bagPath = await openBag(main);

		if (!bagPath) return;

		const definition = await loadBag(main, bagPath);

		addTab(definition.id, bagPath, definition.name);
	}, [addTab]);

	const newBagTab = useCallback(async () => {
		const result = await newBag(main);

		if (!result) return;

		addTab(result.definition.id, result.bagPath, result.definition.name);
	}, [addTab]);

	const renameTab = useCallback((tabId: string, newName: string) => {
		const callback = renameCallbacksRef.current.get(tabId);

		if (callback) {
			callback(newName);
		}
	}, []);

	const context: AppContext = useMemo(
		() => ({
			app,
			appStore,
			logger,
			main,
			queryClient,
			userDataPath,
			windowId,
			historyStacks: historyStacksRef.current,
			tabNames: tabNamesRef.current,
			renameCallbacks: renameCallbacksRef.current,
			openBagTab,
			newBagTab,
			renameTab,
		}),
		[app, windowId, userDataPath, openBagTab, newBagTab, renameTab],
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
}
