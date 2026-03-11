import { unregisterPackage } from "../../../models/ModuleRegistry";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import {
	UNLOAD_PACKAGE_MODULES_ACTION,
	type UnloadPackageModulesInput,
	type UnloadPackageModulesIpcParameters,
	type UnloadPackageModulesIpcReturn,
} from "./Renderer";

export class UnloadPackageModulesMainIpc extends AsyncMainIpc<UnloadPackageModulesIpcParameters, UnloadPackageModulesIpcReturn> {
	action = UNLOAD_PACKAGE_MODULES_ACTION;

	handler(input: UnloadPackageModulesInput, dependencies: IpcHandlerDependencies): UnloadPackageModulesIpcReturn {
		unregisterPackage(dependencies.moduleRegistry, input.packageName);
		return undefined;
	}
}
