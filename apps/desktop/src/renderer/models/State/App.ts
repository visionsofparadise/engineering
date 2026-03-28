import type { Snapshot } from "valtio/vanilla";
import { z } from "zod";
import type { State } from ".";
import type { MainWithEvents } from "../Main";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------


const TabEntrySchema = z.object({
	id: z.string(),
	label: z.string(),
	filePath: z.string(),
});

const ModulePackageConfigSchema = z.object({
	url: z.string(),
	directory: z.string(),
});

const LoadedModuleInfoSchema = z.object({
	moduleName: z.string(),
	moduleDescription: z.string(),
	schema: z.unknown(),
});

const ModulePackageStateSchema = ModulePackageConfigSchema.extend({
	status: z.enum(["pending", "cloning", "building", "loading", "ready", "skipped", "error"]),
	error: z.string().optional(),
	version: z.string().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	modules: z.array(LoadedModuleInfoSchema).readonly(),
});

const WindowStateSchema = z.object({
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
	maximized: z.boolean(),
});

export const AppStateSchema = z.object({
	activeTabId: z.string().optional(),
	tabs: z.array(TabEntrySchema).readonly(),
	theme: z.enum(["light", "dark", "system"]),
	spectralTheme: z.enum(["lava", "viridis"]),
	windowState: WindowStateSchema.optional(),
	binaries: z.record(z.string(), z.string()),
	packageUrls: z.array(ModulePackageConfigSchema).readonly(),
	packages: z.array(ModulePackageStateSchema).readonly(),
});

// ---------------------------------------------------------------------------
// Types (inferred from schemas)
// ---------------------------------------------------------------------------

export type Theme = z.infer<typeof AppStateSchema>["theme"];
export type SpectralTheme = z.infer<typeof AppStateSchema>["spectralTheme"];
export type TabEntry = z.infer<typeof TabEntrySchema>;
export type ModulePackageConfig = z.infer<typeof ModulePackageConfigSchema>;
export type LoadedModuleInfo = z.infer<typeof LoadedModuleInfoSchema>;
export type ModulePackageState = z.infer<typeof ModulePackageStateSchema>;
export type AppState = z.infer<typeof AppStateSchema> & State;

async function deriveTabsFromSessions(main: MainWithEvents, userDataPath: string): Promise<ReadonlyArray<TabEntry>> {
	const sessionsDir = `${userDataPath}/sessions`;

	try {
		const entries = await main.readDirectory(sessionsDir);
		const tabs: Array<TabEntry> = [];

		for (const entry of entries) {
			if (!entry.endsWith(".bag")) continue;

			const filePath = `${sessionsDir}/${entry}`;

			let label = entry.replace(/\.bag$/, "");

			try {
				const content = await main.readFile(filePath);
				const parsed = JSON.parse(content) as { name?: string };

				if (parsed.name) label = parsed.name;
			} catch {
				// could not read .bag file
			}

			tabs.push({
				id: entry,
				label,
				filePath,
			});
		}

		return tabs;
	} catch {
		return [];
	}
}

const PLATFORM_DIR = `${process.platform}-${process.arch}`;

const BUNDLED_PLATFORM_BINARIES: Record<string, string> = {
	ffmpeg: `ffmpeg${process.platform === "win32" ? ".exe" : ""}`,
	ffprobe: `ffprobe${process.platform === "win32" ? ".exe" : ""}`,
	"onnx-addon": "onnx_addon.node",
	"vkfft-addon": "vkfft_addon.node",
	"fftw-addon": "fftw_addon.node",
};

const BUNDLED_MODEL_BINARIES: Record<string, string> = {
	"dtln-model_1": "dtln-model_1.onnx",
	"dtln-model_2": "dtln-model_2.onnx",
	Kim_Vocal_2: "Kim_Vocal_2.onnx",
	htdemucs: "htdemucs.onnx",
};

async function resolveBundledBinaries(
	saved: Record<string, string> | undefined,
	resourcesPath: string,
	main: MainWithEvents,
): Promise<Record<string, string>> {
	const binaries: Record<string, string> = { ...saved };
	const binariesRoot = `${resourcesPath}/binaries`;

	for (const [key, filename] of Object.entries(BUNDLED_PLATFORM_BINARIES)) {
		if (binaries[key]) continue;

		const bundledPath = `${binariesRoot}/${PLATFORM_DIR}/${filename}`;

		try {
			await main.stat(bundledPath);
			binaries[key] = bundledPath;
		} catch {
			// bundled binary not found for this platform — leave unset
		}
	}

	for (const [key, filename] of Object.entries(BUNDLED_MODEL_BINARIES)) {
		if (binaries[key]) continue;

		const bundledPath = `${binariesRoot}/models/${filename}`;

		try {
			await main.stat(bundledPath);
			binaries[key] = bundledPath;
		} catch {
			// bundled model not found — leave unset
		}
	}

	return binaries;
}

/** Schema for the subset of AppState that is persisted to state.json. */
const SavedStateSchema = AppStateSchema.pick({
	theme: true,
	spectralTheme: true,
	activeTabId: true,
	tabs: true,
	windowState: true,
	binaries: true,
	packageUrls: true,
}).partial();

export async function loadAppState(main: MainWithEvents): Promise<Omit<AppState, "_key">> {
	const userDataPath = await main.getUserDataPath();
	const resourcesPath = await main.getResourcesPath();
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

	let tabs: ReadonlyArray<TabEntry>;

	if (saved.tabs && saved.tabs.length > 0) {
		// Restore persisted tabs, filtering out any whose .bag file no longer exists
		const validTabs: Array<TabEntry> = [];

		for (const tab of saved.tabs) {
			try {
				await main.stat(tab.filePath);
				validTabs.push(tab);
			} catch {
				// .bag file no longer exists — skip this tab
			}
		}

		tabs = validTabs;
	} else {
		// No saved tabs — derive from filesystem (migration / first launch)
		tabs = await deriveTabsFromSessions(main, userDataPath);
	}

	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
		? saved.activeTabId
		: tabs[0]?.id;

	const binaries = await resolveBundledBinaries(saved.binaries, resourcesPath, main);

	return {
		theme: saved.theme ?? "dark",
		spectralTheme: saved.spectralTheme ?? "lava",
		tabs,
		activeTabId,
		windowState: saved.windowState,
		binaries,
		packageUrls: saved.packageUrls ?? CORE_PACKAGE_URLS,
		packages: [],
	};
}

const CORE_PACKAGE_URLS: ReadonlyArray<ModulePackageConfig> = [
	{ url: "https://github.com/visionsofparadise/buffered-audio-nodes.git", directory: "@e9g/buffered-audio-nodes" },
];

export function useAppState(initial: Partial<AppState>, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(
		{
			theme: "dark",
			spectralTheme: "lava",
			tabs: [],
			activeTabId: undefined,
			binaries: {},
			packageUrls: CORE_PACKAGE_URLS,
			packages: [],
			...initial,
		},
		store,
	);
}
