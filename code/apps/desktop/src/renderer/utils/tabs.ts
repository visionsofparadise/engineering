import type { Snapshot } from "valtio/vanilla";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState, TabEntry } from "../models/State/App";

interface TabContext {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
}

export function addTab(entry: TabEntry, context: TabContext): void {
	const { appStore, app } = context;

	appStore.mutate(app, (proxy) => {
		proxy.tabs.push(entry);
		proxy.activeTabId = entry.id;
	});
}

export function removeTab(tabId: string, context: TabContext): void {
	const { appStore, app } = context;

	appStore.mutate(app, (proxy) => {
		const index = proxy.tabs.findIndex((entry) => entry.id === tabId);

		if (index === -1) return;

		proxy.tabs.splice(index, 1);

		if (proxy.activeTabId === tabId) {
			if (proxy.tabs.length > 0) {
				const adjacentIndex = Math.min(index, proxy.tabs.length - 1);

				proxy.activeTabId = proxy.tabs[adjacentIndex]?.id;
			} else {
				proxy.activeTabId = undefined;
			}
		}
	});
}

export function reorderTabs(fromIndex: number, toIndex: number, context: TabContext): void {
	const { appStore, app } = context;

	appStore.mutate(app, (proxy) => {
		const tab = proxy.tabs[fromIndex];

		if (!tab) return;

		proxy.tabs.splice(fromIndex, 1);
		proxy.tabs.splice(toIndex, 0, tab);
	});
}

export function setActiveTab(tabId: string, context: TabContext): void {
	const { appStore, app } = context;

	appStore.mutate(app, (proxy) => {
		proxy.activeTabId = tabId;
	});
}
