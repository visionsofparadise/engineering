import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface LoadPackageModulesInput {
	readonly bundlePath: string;
	readonly packageName: string;
}

export interface LoadedModuleInfo {
	readonly moduleName: string;
	readonly moduleDescription: string;
	readonly schema: unknown;
}

export type LoadPackageModulesIpcParameters = [input: LoadPackageModulesInput];
export type LoadPackageModulesIpcReturn = ReadonlyArray<LoadedModuleInfo>;
export const LOAD_PACKAGE_MODULES_ACTION = "loadPackageModules" as const;

export class LoadPackageModulesRendererIpc extends AsyncRendererIpc<
	typeof LOAD_PACKAGE_MODULES_ACTION,
	LoadPackageModulesIpcParameters,
	LoadPackageModulesIpcReturn
> {
	action = LOAD_PACKAGE_MODULES_ACTION;
}
