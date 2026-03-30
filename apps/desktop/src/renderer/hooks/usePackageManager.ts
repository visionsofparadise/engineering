import { useCallback } from "react";
import type { AppContext } from "../models/Context";
import type { ModulePackageState } from "../models/State/App";
import { mutatePackageAt, runPackagePipeline, urlToDirectoryName } from "./packagePipeline";

export interface PackageManager {
	addPackage: (url: string) => Promise<void>;
	removePackage: (name: string) => Promise<void>;
	updatePackage: (name: string) => Promise<void>;
}

export function usePackageManager(context: AppContext): PackageManager {
	const { app, appStore, main, userDataPath } = context;

	const addPackage = useCallback(
		async (url: string): Promise<void> => {
			if (!url.startsWith("https://")) {
				throw new Error("Package URL must start with https://");
			}

			// Derive name from URL (last two path segments joined with /)
			const segments = url.replace(/\/+$/, "").split("/");
			const owner = segments[segments.length - 2] ?? "";
			const repo = segments[segments.length - 1] ?? "";
			const name = `${owner}/${repo}`;

			const newEntry: ModulePackageState = {
				url,
				name,
				version: null,
				status: "pending",
				error: null,
				modules: [],
				isBuiltIn: false,
			};

			// Append new package
			appStore.mutate(app, (proxy) => {
				proxy.packages.push(newEntry);
			});

			// Snapshot is stale after mutate — app.packages.length is the pre-push
			// count, which equals the index of the newly appended entry.
			const index = app.packages.length;

			try {
				await runPackagePipeline({ ...newEntry }, index, app, appStore, main, userDataPath);
			} catch (error) {
				mutatePackageAt(appStore, app, index, (target) => {
					target.status = "error";
					target.error = error instanceof Error ? error.message : String(error);
				});
			}
		},
		[app, appStore, main, userDataPath],
	);

	const removePackage = useCallback(
		async (name: string): Promise<void> => {
			const index = app.packages.findIndex((entry) => entry.name === name);

			if (index === -1) return;

			const entry = app.packages[index];

			if (!entry || entry.isBuiltIn) return;

			// Unload modules from the main process registry
			await main.unloadPackageModules({ packageName: name });

			// Delete the package directory from disk
			const directory = `${userDataPath}/packages/${urlToDirectoryName(entry.url)}`;

			await main.deleteFile(directory);

			// Remove from state
			appStore.mutate(app, (proxy) => {
				proxy.packages.splice(index, 1);
			});
		},
		[app, appStore, main, userDataPath],
	);

	const updatePackage = useCallback(
		async (name: string): Promise<void> => {
			const index = app.packages.findIndex((entry) => entry.name === name);

			if (index === -1) return;

			const entry = app.packages[index];

			if (!entry) return;

			// Unload old modules
			await main.unloadPackageModules({ packageName: name });

			// Delete the existing directory for a fresh clone
			const directory = `${userDataPath}/packages/${urlToDirectoryName(entry.url)}`;

			await main.deleteFile(directory);

			// Reset to pending
			mutatePackageAt(appStore, app, index, (target) => {
				target.status = "pending";
				target.error = null;
				target.modules = [];
				target.version = null;
			});

			// Run the full pipeline
			try {
				await runPackagePipeline(
					{ ...entry, status: "pending", error: null, modules: [], version: null },
					index,
					app,
					appStore,
					main,
					userDataPath,
				);
			} catch (error) {
				mutatePackageAt(appStore, app, index, (target) => {
					target.status = "error";
					target.error = error instanceof Error ? error.message : String(error);
				});
			}
		},
		[app, appStore, main, userDataPath],
	);

	return { addPackage, removePackage, updatePackage };
}
