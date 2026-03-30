import type { Snapshot } from "valtio/vanilla";
import { z } from "zod";
import type { State } from ".";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TabEntrySchema = z.object({
	id: z.string(),
	bagPath: z.string(),
});

const RecentFileSchema = z.object({
	id: z.string(),
	bagPath: z.string(),
	name: z.string(),
	lastOpened: z.number(),
});

const WindowBoundsSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
});

export const AppStateSchema = z.object({
	tabs: z.array(TabEntrySchema).default([]),
	activeTabId: z.string().nullable().default(null),
	theme: z.enum(["lava", "viridis"]).default("lava"),
	windowBounds: WindowBoundsSchema.optional(),
	recentFiles: z.array(RecentFileSchema).default([]),
	packages: z.array(z.unknown()).default([]),
	binaries: z.record(z.string(), z.string()).default({}),
});

// ---------------------------------------------------------------------------
// Types (inferred from schemas)
// ---------------------------------------------------------------------------

export type TabEntry = z.infer<typeof TabEntrySchema>;
export type RecentFile = z.infer<typeof RecentFileSchema>;
export type WindowBounds = z.infer<typeof WindowBoundsSchema>;
export type AppState = z.infer<typeof AppStateSchema> & State;

// ---------------------------------------------------------------------------
// Saved state (subset for persistence)
// ---------------------------------------------------------------------------

const SavedStateSchema = AppStateSchema.pick({
	tabs: true,
	activeTabId: true,
	theme: true,
	windowBounds: true,
	recentFiles: true,
	binaries: true,
}).partial();

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadAppState(main: { getUserDataPath: () => Promise<string>; readFile: (path: string) => Promise<string> }): Promise<Omit<AppState, "_key">> {
	const userDataPath = await main.getUserDataPath();
	const path = `${userDataPath}/state.json`;

	let saved: z.infer<typeof SavedStateSchema> = {};

	try {
		const content = await main.readFile(path);
		const result = SavedStateSchema.safeParse(JSON.parse(content));

		if (result.success) {
			saved = result.data;
		}
	} catch {
		// no saved state
	}

	const tabs = saved.tabs ?? [];

	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
		? (saved.activeTabId ?? null)
		: (tabs[0]?.id ?? null);

	return {
		tabs,
		activeTabId,
		theme: saved.theme ?? "lava",
		windowBounds: saved.windowBounds,
		recentFiles: saved.recentFiles ?? [],
		packages: [],
		binaries: saved.binaries ?? {},
	};
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAppState(initial: Omit<AppState, "_key">, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(initial, store);
}
