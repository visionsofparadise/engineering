import { pathToFileURL } from "node:url";
import { toJSONSchema } from "zod";
import { registerPackage } from "../../../../main/moduleRegistry";
import type { ModuleClass } from "../../../models/ModuleRegistry";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import {
	LOAD_PACKAGE_MODULES_ACTION,
	type LoadPackageModulesInput,
	type LoadPackageModulesIpcParameters,
	type LoadPackageModulesIpcReturn,
	type LoadedModuleInfo,
} from "./Renderer";

function isModuleClass(value: unknown): value is ModuleClass {
	return (
		typeof value === "function" &&
		"moduleName" in value &&
		typeof value.moduleName === "string" &&
		"moduleDescription" in value &&
		typeof value.moduleDescription === "string" &&
		"schema" in value
	);
}

export class LoadPackageModulesMainIpc extends AsyncMainIpc<LoadPackageModulesIpcParameters, LoadPackageModulesIpcReturn> {
	action = LOAD_PACKAGE_MODULES_ACTION;

	async handler(input: LoadPackageModulesInput, _dependencies: IpcHandlerDependencies): Promise<LoadPackageModulesIpcReturn> {
		const url = `${pathToFileURL(input.bundlePath).href}?t=${Date.now()}`;
		const exports = (await import(url)) as Record<string, unknown>;
		const modules = new Map<string, ModuleClass>();
		const result: Array<LoadedModuleInfo> = [];

		for (const value of Object.values(exports)) {
			if (isModuleClass(value)) {
				modules.set(value.moduleName, value);
				result.push({
					moduleName: value.moduleName,
					moduleDescription: value.moduleDescription,
					schema: toJSONSchema(value.schema),
				});
			}
		}

		registerPackage(input.packageName, modules);
		return result;
	}
}
