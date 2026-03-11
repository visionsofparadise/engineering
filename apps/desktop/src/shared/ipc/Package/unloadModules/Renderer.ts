import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface UnloadPackageModulesInput {
	readonly packageName: string;
}

export type UnloadPackageModulesIpcParameters = [input: UnloadPackageModulesInput];
export type UnloadPackageModulesIpcReturn = undefined;
export const UNLOAD_PACKAGE_MODULES_ACTION = "unloadPackageModules" as const;

export class UnloadPackageModulesRendererIpc extends AsyncRendererIpc<
	typeof UNLOAD_PACKAGE_MODULES_ACTION,
	UnloadPackageModulesIpcParameters,
	UnloadPackageModulesIpcReturn
> {
	action = UNLOAD_PACKAGE_MODULES_ACTION;
}
