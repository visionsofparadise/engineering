import type { Snapshot } from "valtio/vanilla";
import { z } from "zod";
import type { State } from ".";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

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

const LoadedModuleInfoSchema = z.object({
	moduleName: z.string(),
	moduleDescription: z.string(),
	schema: z.unknown(),
	category: z.enum(["source", "transform", "target"]),
});

const ModulePackageStateSchema = z.object({
	url: z.string(),
	name: z.string(),
	version: z.string().nullable().default(null),
	status: z.enum(["pending", "cloning", "building", "loading", "ready", "error"]).default("pending"),
	error: z.string().nullable().default(null),
	modules: z.array(LoadedModuleInfoSchema).default([]),
	isBuiltIn: z.boolean().default(false),
});

export const AppStateSchema = z.object({
	tabs: z.array(TabEntrySchema).default([]),
	activeTabId: z.string().nullable().default(null),
	theme: z.enum(["lava", "viridis"]).default("lava"),
	windowBounds: WindowBoundsSchema.optional(),
	recentFiles: z.array(RecentFileSchema).default([]),
	packages: z.array(ModulePackageStateSchema).default([]),
	binaries: z.record(z.string(), z.string()).default({}),
});

export type TabEntry = z.infer<typeof TabEntrySchema>;
export type RecentFile = z.infer<typeof RecentFileSchema>;
export type WindowBounds = z.infer<typeof WindowBoundsSchema>;
export type ModulePackageState = z.infer<typeof ModulePackageStateSchema>;
export type AppState = z.infer<typeof AppStateSchema> & State;

const SavedStateSchema = AppStateSchema.pick({
	tabs: true,
	activeTabId: true,
	theme: true,
	windowBounds: true,
	recentFiles: true,
	packages: true,
	binaries: true,
}).partial();

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

	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId) ? (saved.activeTabId ?? null) : (tabs[0]?.id ?? null);

	const BUILT_IN_PACKAGE: ModulePackageState = {
		url: "https://github.com/visionsofparadise/buffered-audio-nodes",
		name: "@e9g/buffered-audio-nodes",
		version: null,
		status: "pending",
		error: null,
		modules: [],
		isBuiltIn: true,
	};

	let packages: Array<ModulePackageState> = saved.packages ?? [];

	// Reset interrupted sessions — any package not "ready" goes back to "pending"
	packages = packages.map((entry) => (entry.status !== "ready" ? { ...entry, status: "pending" as const, error: null } : entry));

	// Seed built-in package if missing
	if (packages.length === 0) {
		packages = [BUILT_IN_PACKAGE];
	} else if (!packages.some((entry) => entry.isBuiltIn)) {
		packages = [BUILT_IN_PACKAGE, ...packages];
	}

	return {
		tabs,
		activeTabId,
		theme: saved.theme ?? "lava",
		windowBounds: saved.windowBounds,
		recentFiles: saved.recentFiles ?? [],
		packages,
		binaries: saved.binaries ?? {},
	};
}

export function useAppState(initial: Omit<AppState, "_key">, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(initial, store);
}
