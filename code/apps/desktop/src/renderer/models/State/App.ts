import type { Snapshot } from "valtio/vanilla";
import type { State } from ".";
import type { WindowState } from "../../../shared/utilities/emitToRenderer";
import type { MainWithEvents } from "../Main";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

export type Theme = "light" | "dark" | "system";

export interface TabEntry {
	readonly id: string;
	readonly label: string;
	readonly filePath: string;
	readonly workingDir: string;
	readonly activeSnapshotFolder: string | undefined;
}

export interface AppState extends State {
	readonly activeTabId: string | undefined;
	readonly tabs: ReadonlyArray<TabEntry>;
	readonly theme: Theme;
	readonly windowState?: WindowState;
}

async function deriveTabsFromSessions(main: MainWithEvents, userDataPath: string): Promise<ReadonlyArray<TabEntry>> {
	const sessionsDir = `${userDataPath}/sessions`;

	try {
		const folders = await main.readDirectory(sessionsDir);
		const tabs: Array<TabEntry> = [];

		for (const folder of folders) {
			const sessionPath = `${sessionsDir}/${folder}`;
			const entries = await main.readDirectory(sessionPath);
			const snapshots = entries.filter((entry) => entry !== "chain.json").sort();

			if (snapshots.length === 0) continue;

			let label = folder;
			try {
				const chainContent = await main.readFile(`${sessionPath}/chain.json`);
				const chain = JSON.parse(chainContent) as { label?: string };
				if (chain.label) label = chain.label;
			} catch {
				// no chain.json or no label — derive from first snapshot
				const firstSnapshot = snapshots[0];
				if (firstSnapshot) {
					const sourceMatch = /-(.+)$/.exec(firstSnapshot);
					if (sourceMatch?.[1]) label = sourceMatch[1];
				}
			}

			tabs.push({
				id: folder,
				label,
				filePath: "",
				workingDir: sessionPath,
				activeSnapshotFolder: undefined,
			});
		}

		return tabs;
	} catch {
		return [];
	}
}

export async function loadAppState(main: MainWithEvents): Promise<AppState | undefined> {
	const userDataPath = await main.getUserDataPath();
	const path = `${userDataPath}/state.json`;

	let saved: Partial<AppState> = {};
	try {
		const content = await main.readFile(path);
		saved = JSON.parse(content) as AppState;
	} catch {
		// no saved state
	}

	const tabs = await deriveTabsFromSessions(main, userDataPath);
	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
		? saved.activeTabId
		: tabs[0]?.id;

	return {
		theme: saved.theme ?? "dark",
		tabs,
		activeTabId,
		windowState: saved.windowState,
	} as AppState;
}

export function useAppState(initial: Partial<AppState>, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(
		{
			theme: "dark",
			tabs: [],
			activeTabId: undefined,
			...initial,
		},
		store,
	);
}
