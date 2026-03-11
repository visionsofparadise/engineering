import type { AppContext } from "../models/Context";
import type { ModulePackageState } from "../models/State/App";
import { initializePackage } from "./initializePackages";

interface UpdateCheckResult {
	readonly updateAvailable: boolean;
	readonly currentVersion: string;
	readonly latestVersion: string;
}

export async function checkPackageUpdate(
	packageState: ModulePackageState,
	context: AppContext,
): Promise<UpdateCheckResult> {
	const { main, userDataPath } = context;
	const tempDir = `${userDataPath}/packages/.update-check-${packageState.directory}`;

	try {
		await main.gitClone({ url: packageState.url, directory: tempDir });
		const raw = await main.readFile(`${tempDir}/package.json`);
		const latestJson = JSON.parse(raw) as { version?: string };
		const latestVersion = latestJson.version ?? "0.0.0";
		const currentVersion = packageState.version ?? "0.0.0";

		const updateAvailable = latestVersion !== currentVersion;

		return { updateAvailable, currentVersion, latestVersion };
	} finally {
		try {
			await main.deleteFile(tempDir);
		} catch {
			// cleanup failure is not critical
		}
	}
}

export async function applyPackageUpdate(
	directory: string,
	context: AppContext,
): Promise<void> {
	const { app, appStore, main, userDataPath } = context;
	const cloneDir = `${userDataPath}/packages/${directory}`;
	const config = app.packageUrls.find((conf) => conf.directory === directory);
	if (!config) return;

	await main.unloadPackageModules({ packageName: directory });

	try {
		await main.deleteFile(cloneDir);
	} catch {
		// may not exist
	}

	const index = app.packages.findIndex((ps) => ps.directory === directory);
	if (index >= 0) {
		appStore.mutate(app, (proxy) => {
			const existing = proxy.packages[index];
			if (existing) {
				existing.status = "pending";
				existing.modules = [];
				existing.version = undefined;
				existing.error = undefined;
			}
		});

		await initializePackage(config, index, context);
	}
}
