import type { Snapshot } from "valtio/vanilla";
import type { Main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState, ModulePackageState } from "../models/State/App";

export function urlToDirectoryName(url: string): string {
	const segments = url.replace(/\/+$/, "").split("/");
	const repo = segments[segments.length - 1] ?? "";
	const owner = segments[segments.length - 2] ?? "";

	return `${owner}--${repo}`;
}

export function mutatePackageAt(
	appStore: ProxyStore,
	app: Snapshot<AppState>,
	index: number,
	callback: (entry: {
		status: string;
		error: string | null;
		modules: Array<{ moduleName: string; moduleDescription: string; schema: unknown }>;
		version: string | null;
	}) => void,
): void {
	appStore.mutate(app, (proxy) => {
		const entry = proxy.packages[index];

		if (entry) {
			callback(entry);
		}
	});
}

export async function runPackagePipeline(
	entry: Snapshot<ModulePackageState>,
	index: number,
	app: Snapshot<AppState>,
	appStore: ProxyStore,
	main: Main,
	userDataPath: string,
): Promise<void> {
	const directory = `${userDataPath}/packages/${urlToDirectoryName(entry.url)}`;
	const bundlePath = `${directory}/dist/bundle.mjs`;

	// 1. Clone
	mutatePackageAt(appStore, app, index, (target) => {
		target.status = "cloning";
	});

	let directoryExists = false;

	try {
		await main.stat(directory);
		directoryExists = true;
	} catch {
		// directory does not exist
	}

	if (!directoryExists) {
		await main.gitClone({ url: entry.url, directory });
	}

	// 2. Build
	mutatePackageAt(appStore, app, index, (target) => {
		target.status = "building";
	});

	await main.bundlePackage({ sourceDirectory: directory, outputPath: bundlePath });

	// 3. Load
	mutatePackageAt(appStore, app, index, (target) => {
		target.status = "loading";
	});

	const modules = await main.loadPackageModules({ bundlePath, packageName: entry.name });

	let version: string | null = null;

	try {
		const packageJsonContent = await main.readFile(`${directory}/package.json`);
		const packageJson = JSON.parse(packageJsonContent) as { version?: string };

		version = packageJson.version ?? null;
	} catch {
		// version extraction failed — non-fatal
	}

	// 4. Ready
	mutatePackageAt(appStore, app, index, (target) => {
		target.status = "ready";
		target.modules = modules as Array<{ moduleName: string; moduleDescription: string; schema: unknown }>;
		target.version = version;
	});
}
