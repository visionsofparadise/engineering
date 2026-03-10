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

export async function loadAppState(main: MainWithEvents): Promise<AppState | undefined> {
	const userDataPath = await main.getUserDataPath();
	const path = `${userDataPath}/state.json`;

	try {
		const content = await main.readFile(path);

		return JSON.parse(content) as AppState;
	} catch {
		return;
	}
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
