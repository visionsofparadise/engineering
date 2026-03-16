import type { Snapshot } from "valtio/vanilla";
import { z } from "zod";
import type { State } from ".";
import type { MainWithEvents } from "../Main";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ChainModuleReferenceSchema = z.object({
	package: z.string().min(1),
	module: z.string().min(1),
	label: z.string().optional(),
	options: z.record(z.string(), z.unknown()).optional(),
	bypass: z.boolean().optional(),
});

const BatchTargetSchema = z.object({
	outputDir: z.string(),
	template: z.string(),
	format: z.enum(["wav", "flac", "mp3", "aac"]),
	bitDepth: z.enum(["16", "24", "32", "32f"]).optional(),
	bitrate: z.string().optional(),
	vbr: z.number().optional(),
});

const BatchFileSchema = z.object({
	path: z.string(),
	jobId: z.string().optional(),
});

const BatchConfigSchema = z.object({
	transforms: z.array(ChainModuleReferenceSchema).readonly(),
	target: BatchTargetSchema,
	concurrency: z.number(),
	files: z.array(BatchFileSchema).readonly(),
});

const TabEntrySchema = z.object({
	id: z.string(),
	label: z.string(),
	filePath: z.string(),
	workingDir: z.string(),
	activeSnapshotFolder: z.string().optional(),
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
	batchActive: z.boolean(),
	tabs: z.array(TabEntrySchema).readonly(),
	theme: z.enum(["light", "dark", "system"]),
	spectralTheme: z.enum(["lava", "viridis"]),
	windowState: WindowStateSchema.optional(),
	batch: BatchConfigSchema,
	binaries: z.record(z.string(), z.string()),
	packageUrls: z.array(ModulePackageConfigSchema).readonly(),
	packages: z.array(ModulePackageStateSchema).readonly(),
});

// ---------------------------------------------------------------------------
// Types (inferred from schemas)
// ---------------------------------------------------------------------------

export type Theme = z.infer<typeof AppStateSchema>["theme"];
export type SpectralTheme = z.infer<typeof AppStateSchema>["spectralTheme"];
export type BatchTarget = z.infer<typeof BatchTargetSchema>;
export type BatchFile = z.infer<typeof BatchFileSchema>;
export type BatchConfig = z.infer<typeof BatchConfigSchema>;
export type TabEntry = z.infer<typeof TabEntrySchema>;
export type ModulePackageConfig = z.infer<typeof ModulePackageConfigSchema>;
export type LoadedModuleInfo = z.infer<typeof LoadedModuleInfoSchema>;
export type ModulePackageState = z.infer<typeof ModulePackageStateSchema>;
export type AppState = z.infer<typeof AppStateSchema> & State;

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

			// Extract filename from guid-filename folder format
			const guidPrefix = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;
			let label = guidPrefix.test(folder) ? folder.replace(guidPrefix, "") : folder;

			try {
				const chainContent = await main.readFile(`${sessionPath}/chain.json`);
				const chain = JSON.parse(chainContent) as { label?: string };
				if (chain.label) label = chain.label;
			} catch {
				// no chain.json
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
	windowState: true,
	batch: true,
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

	const tabs = await deriveTabsFromSessions(main, userDataPath);
	const activeTabId = tabs.some((tab) => tab.id === saved.activeTabId)
		? saved.activeTabId
		: tabs[0]?.id;

	const binaries = await resolveBundledBinaries(saved.binaries, resourcesPath, main);

	return {
		theme: saved.theme ?? "dark",
		spectralTheme: saved.spectralTheme ?? "lava",
		tabs,
		activeTabId,
		batchActive: false,
		windowState: saved.windowState,
		batch: saved.batch ?? defaultBatchConfig(),
		binaries,
		packageUrls: saved.packageUrls ?? CORE_PACKAGE_URLS,
		packages: [],
	};
}

const CORE_PACKAGE_URLS: ReadonlyArray<ModulePackageConfig> = [
	{ url: "https://github.com/visionsofparadise/audio-chain-module.git", directory: "audio-chain-module" },
];

function defaultBatchConfig(): BatchConfig {
	return {
		transforms: [],
		target: {
			outputDir: "",
			template: "{name}",
			format: "wav",
			bitDepth: "24",
		},
		concurrency: navigator.hardwareConcurrency || 4,
		files: [],
	};
}

export function useAppState(initial: Partial<AppState>, store: ProxyStore): Snapshot<AppState> {
	return useCreateState<AppState>(
		{
			theme: "dark",
			spectralTheme: "lava",
			tabs: [],
			activeTabId: undefined,
			batchActive: false,
			batch: defaultBatchConfig(),
			binaries: {},
			packageUrls: CORE_PACKAGE_URLS,
			packages: [],
			...initial,
		},
		store,
	);
}
