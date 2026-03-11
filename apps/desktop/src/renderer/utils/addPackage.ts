import type { AppContext } from "../models/Context";
import { initializePackage } from "./initializePackages";

function deriveDirectory(url: string): string {
	const match = /([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (match?.[1] && match[2]) return `${match[1]}--${match[2]}`;
	return `package-${Date.now()}`;
}

export async function addPackage(url: string, context: AppContext): Promise<void> {
	const { app, appStore } = context;
	const directory = deriveDirectory(url);
	const config = { url, directory };

	appStore.mutate(app, (proxy) => {
		proxy.packageUrls = [...proxy.packageUrls, config];
		proxy.packages = [...proxy.packages, { ...config, status: "pending" as const, modules: [] }];
	});

	const index = app.packageUrls.length;
	await initializePackage(config, index, context);
}
