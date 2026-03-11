import type { Snapshot } from "valtio/vanilla";
import type { AppContext } from "../../../models/Context";
import type { ProxyStore } from "../../../models/ProxyStore/ProxyStore";
import type { AppState, ModulePackageConfig, ModulePackageState } from "../../../models/State/App";

function mutatePackage(appStore: ProxyStore, app: Snapshot<AppState>, index: number, update: Partial<ModulePackageState>): void {
	appStore.mutate(app, (proxy) => {
		const existing = proxy.packages[index];

		if (existing) {
			Object.assign(existing, update);
		}
	});
}

export async function initializePackage(config: ModulePackageConfig, index: number, context: AppContext): Promise<void> {
	const { app, appStore, main, userDataPath } = context;

	const packagesDir = `${userDataPath}/packages`;
	const cloneDir = `${packagesDir}/${config.directory}`;
	const bundlePath = `${cloneDir}/dist/index.js`;

	try {
		await main.ensureDirectory(packagesDir);

		const cloneExists = await main.stat(cloneDir);

		if (!cloneExists) {
			mutatePackage(appStore, app, index, { status: "cloning" });

			await main.gitClone({ url: config.url, directory: cloneDir });
		}

		const bundleExists = await main.stat(bundlePath);

		if (!bundleExists) {
			mutatePackage(appStore, app, index, { status: "building" });

			await main.bundlePackage({ sourceDirectory: cloneDir, outputPath: bundlePath });
		}

		mutatePackage(appStore, app, index, { status: "loading" });

		const modules = await main.loadPackageModules({ bundlePath, packageName: config.directory });

		let version: string | undefined;

		try {
			const raw = await main.readFile(`${cloneDir}/package.json`);
			const packageJson = JSON.parse(raw) as { version?: string };

			version = packageJson.version;
		} catch {
			mutatePackage(appStore, app, index, { status: "error", error: "Failed to read package.json", modules: [...modules] });
			return;
		}

		mutatePackage(appStore, app, index, { status: "ready", modules: [...modules], version });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		mutatePackage(appStore, app, index, { status: "error", error: message });
	}
}

export async function initializeAllPackages(context: AppContext): Promise<void> {
	const { app, appStore } = context;

	appStore.mutate(app, (proxy) => {
		proxy.packages = app.packageUrls.map((config) => ({
			...config,
			status: "pending" as const,
			modules: [],
		}));
	});

	for (let index = 0; index < app.packageUrls.length; index++) {
		const config = app.packageUrls[index];

		if (config) {
			await initializePackage(config, index, context);
		}
	}
}
