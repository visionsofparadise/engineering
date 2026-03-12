import type { ChainModuleReference } from "@engineering/acm";
import type { Snapshot } from "valtio/vanilla";
import type { State } from ".";
import type { WindowState } from "../../../shared/utilities/emitToRenderer";
import type { MainWithEvents } from "../Main";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";

export type Theme = "light" | "dark" | "system";

export interface BatchTarget {
	readonly outputDir: string;
	readonly template: string;
	readonly format: "wav" | "flac" | "mp3" | "aac";
	readonly bitDepth?: "16" | "24" | "32" | "32f";
	readonly bitrate?: string;
	readonly vbr?: number;
}

export interface BatchFile {
	readonly path: string;
	readonly jobId?: string;
}

export interface BatchConfig {
	readonly transforms: ReadonlyArray<ChainModuleReference>;
	readonly target: BatchTarget;
	readonly concurrency: number;
	readonly files: ReadonlyArray<BatchFile>;
}

export interface TabEntry {
	readonly id: string;
	readonly label: string;
	readonly filePath: string;
	readonly workingDir: string;
	readonly activeSnapshotFolder: string | undefined;
}

export interface ModulePackageConfig {
	readonly url: string;
	readonly directory: string;
	readonly core?: boolean;
}

export interface LoadedModuleInfo {
	readonly moduleName: string;
	readonly moduleDescription: string;
	readonly schema: unknown;
}

export interface ModulePackageState extends ModulePackageConfig {
	readonly status: "pending" | "cloning" | "building" | "loading" | "ready" | "skipped" | "error";
	readonly error?: string;
	readonly version?: string;
	readonly modules: ReadonlyArray<LoadedModuleInfo>;
}

export interface AppState extends State {
	readonly activeTabId: string | undefined;
	readonly tabs: ReadonlyArray<TabEntry>;
	readonly theme: Theme;
	readonly windowState?: WindowState;
	readonly batch: BatchConfig;
	readonly binaries: Record<string, string>;
	readonly packageUrls: ReadonlyArray<ModulePackageConfig>;
	readonly packages: ReadonlyArray<ModulePackageState>;
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

const BUNDLED_BINARIES: Record<string, string> = {
	ffmpeg: `ffmpeg-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
	ffprobe: `ffprobe-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`,
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

	for (const [key, filename] of Object.entries(BUNDLED_BINARIES)) {
		if (binaries[key]) continue;

		const bundledPath = `${resourcesPath}/binaries/${filename}`;

		try {
			await main.stat(bundledPath);
			binaries[key] = bundledPath;
		} catch {
			// bundled binary not found — leave unset
		}
	}

	return binaries;
}

export async function loadAppState(main: MainWithEvents): Promise<Omit<AppState, "_key"> | undefined> {
	const userDataPath = await main.getUserDataPath();
	const resourcesPath = await main.getResourcesPath();
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

	const binaries = await resolveBundledBinaries(saved.binaries as Record<string, string> | undefined, resourcesPath, main);

	return {
		theme: saved.theme ?? "dark",
		tabs,
		activeTabId,
		windowState: saved.windowState,
		batch: saved.batch ?? defaultBatchConfig(),
		binaries,
		packageUrls: mergeWithCoreDefaults(saved.packageUrls),
		packages: [],
	};
}

const CORE_PACKAGE_URLS: ReadonlyArray<ModulePackageConfig> = [
	{ url: "https://github.com/engineering/acm", directory: "acm", core: true },
];

function mergeWithCoreDefaults(saved: ReadonlyArray<ModulePackageConfig> | undefined): ReadonlyArray<ModulePackageConfig> {
	if (!saved) return CORE_PACKAGE_URLS;
	const savedDirs = new Set(saved.map((config) => config.directory));
	const missing = CORE_PACKAGE_URLS.filter((config) => !savedDirs.has(config.directory));
	return [...missing, ...saved.map((config) => {
		const coreMatch = CORE_PACKAGE_URLS.find((core) => core.directory === config.directory);
		return coreMatch ? { ...config, core: true } : config;
	})];
}

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
			tabs: [],
			activeTabId: undefined,
			batch: defaultBatchConfig(),
			binaries: {},
			packageUrls: CORE_PACKAGE_URLS,
			packages: [],
			...initial,
		},
		store,
	);
}
