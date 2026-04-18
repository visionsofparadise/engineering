import type { QueryClient } from "@tanstack/react-query";
import type { MenuItem } from "@e9g/design-system";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Logger } from "../../shared/models/Logger";
import { useAutosave } from "../hooks/useAutosave";
import { useBinaryDefaults } from "../hooks/useBinaryDefaults";
import { ensureGraphPackagesInstalled } from "../hooks/packagePipeline";
import { usePackageLoader } from "../hooks/usePackageLoader";
import { useWindowState } from "../hooks/useWindowState";
import type { AppContext, HistoryState } from "../models/Context";
import { main } from "../models/Main";
import { MainEvents } from "../models/MainEvents";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import { useAppState, type AppState } from "../models/State/App";
import { loadBag, newBag, openBag } from "../utilities/bagOperations";
import { LoadingScreen } from "./LoadingScreen";
import { BinaryManager } from "./BinaryManager";
import { ModuleManager } from "./ModuleManager";
import { AppTabBar } from "./TabBar";
import { TitleBar } from "./TitleBar";
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

	const mainEvents = useMemo(() => new MainEvents(main), []);

	useWindowState(app, appStore, main, mainEvents);
	useBinaryDefaults(app, appStore, main);
	useAutosave(app, appStore, main, userDataPath);

	const { isLoading } = usePackageLoader(app, appStore, main);
	const hasUnresolvedPackages = app.packages.some((entry) => entry.status !== "ready" && entry.status !== "error");
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
	const importCallbacksRef = useRef(new Map<string, () => Promise<void>>());
	const undoCallbacksRef = useRef(new Map<string, () => void>());
	const redoCallbacksRef = useRef(new Map<string, () => void>());

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

	const openBagByPath = useCallback(
		async (bagPath: string) => {
			const definition = await loadBag(main, bagPath);

			setHasPassedLoading(false);

			try {
				await ensureGraphPackagesInstalled(definition, app, appStore, main);
			} catch (error) {
				logger.error("Failed to install exact package versions required by bag", error as Error, {
					namespace: "packages",
					bagPath,
				});
			} finally {
				setHasPassedLoading(true);
			}

			addTab(definition.id, bagPath, definition.name);
		},
		[addTab, app, appStore, logger],
	);

	const openBagTab = useCallback(async () => {
		const bagPath = await openBag(main);

		if (!bagPath) return;

		await openBagByPath(bagPath);
	}, [openBagByPath]);

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

	const importBagIntoActiveTab = useCallback(async () => {
		const activeTabId = app.activeTabId;

		if (!activeTabId) return;

		const callback = importCallbacksRef.current.get(activeTabId);

		if (!callback) return;

		await callback();
	}, [app.activeTabId]);

	const context: AppContext = useMemo(
		() => ({
			app,
			appStore,
			logger,
			main,
			mainEvents,
			queryClient,
			userDataPath,
			windowId,
			historyStacks: historyStacksRef.current,
			tabNames: tabNamesRef.current,
			renameCallbacks: renameCallbacksRef.current,
			importCallbacks: importCallbacksRef.current,
			undoCallbacks: undoCallbacksRef.current,
			redoCallbacks: redoCallbacksRef.current,
			openBagTab,
			openBagByPath,
			newBagTab,
			renameTab,
			importBagIntoActiveTab,
		}),
		[app, mainEvents, windowId, userDataPath, openBagTab, openBagByPath, newBagTab, renameTab, importBagIntoActiveTab],
	);

	const hasActiveGraphTab = app.activeTabId !== null;

	const menuItems: ReadonlyArray<MenuItem> = useMemo(
		() => [
			{
				kind: "action",
				icon: "lucide:file-plus",
				label: "New Graph",
				shortcut: "Ctrl+N",
				onClick: () => void context.newBagTab(),
			},
			{
				kind: "action",
				icon: "lucide:folder-open",
				label: "Open Graph",
				shortcut: "Ctrl+O",
				onClick: () => void context.openBagTab(),
			},
			{
				kind: "action",
				icon: "lucide:import",
				label: "Import Bag",
				shortcut: "Ctrl+Shift+O",
				onClick: () => void context.importBagIntoActiveTab(),
				disabled: !hasActiveGraphTab,
			},
			{
				kind: "action",
				icon: "lucide:save",
				label: "Save",
				shortcut: "Ctrl+S",
				disabled: !hasActiveGraphTab,
			},
			{
				kind: "action",
				icon: "lucide:save-all",
				label: "Save As\u2026",
				shortcut: "Ctrl+Shift+S",
				disabled: !hasActiveGraphTab,
			},
			{ kind: "separator" },
			{
				kind: "action",
				icon: "lucide:undo-2",
				label: "Undo",
				shortcut: "Ctrl+Z",
				onClick: () => context.undoCallbacks.get(app.activeTabId ?? "")?.(),
				disabled: !hasActiveGraphTab,
			},
			{
				kind: "action",
				icon: "lucide:redo-2",
				label: "Redo",
				shortcut: "Ctrl+Shift+Z",
				onClick: () => context.redoCallbacks.get(app.activeTabId ?? "")?.(),
				disabled: !hasActiveGraphTab,
			},
			{ kind: "separator" },
			{
				kind: "action",
				icon: "lucide:blocks",
				label: "Package Manager",
				onClick: openModuleManager,
			},
			{
				kind: "action",
				icon: "lucide:hard-drive",
				label: "Binaries Manager",
				onClick: openBinaryManager,
			},
			{ kind: "separator" },
			{
				kind: "action",
				icon: "lucide:settings",
				label: "Settings",
				shortcut: "Ctrl+,",
			},
			{ kind: "separator" },
			{
				kind: "action",
				icon: "lucide:x",
				label: "Close",
				shortcut: "Ctrl+Q",
				onClick: () => void main.quitApp(),
			},
		],
		[app.activeTabId, context, hasActiveGraphTab, openModuleManager, openBinaryManager],
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
				isLoading={isLoading || hasUnresolvedPackages}
				onContinue={() => setHasPassedLoading(true)}
				theme={app.theme}
			/>
		);
	}

	return (
		<div className="flex flex-col h-screen">
			<TitleBar context={context} menuItems={menuItems} />
			<AppTabBar context={context} />
			<TabContent context={context} />
			<ModuleManager context={context} isOpen={moduleManagerOpen} onClose={closeModuleManager} />
			<BinaryManager context={context} isOpen={binaryManagerOpen} onClose={closeBinaryManager} />
		</div>
	);
}
