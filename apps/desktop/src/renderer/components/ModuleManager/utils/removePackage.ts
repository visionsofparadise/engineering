import type { AppContext } from "../../../models/Context";

export async function removePackage(directory: string, context: AppContext): Promise<void> {
	const { app, appStore, main, userDataPath } = context;

	const config = app.packageUrls.find((entry) => entry.directory === directory);
	if (config?.core) return;

	appStore.mutate(app, (proxy) => {
		proxy.packageUrls = proxy.packageUrls.filter((config) => config.directory !== directory);
		proxy.packages = proxy.packages.filter((ps) => ps.directory !== directory);
	});

	await main.unloadPackageModules({ packageName: directory });

	try {
		await main.deleteFile(`${userDataPath}/packages/${directory}`);
	} catch {
		// directory may not exist
	}
}
