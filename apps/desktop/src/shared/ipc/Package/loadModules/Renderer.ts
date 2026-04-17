import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

/** A single property from Zod v4's toJSONSchema() output. Meta fields from .meta() are flattened to the top level. */
export interface ModuleJsonSchemaProperty {
	readonly type?: string;
	readonly enum?: ReadonlyArray<string>;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly multipleOf?: number;
	readonly default?: unknown;
	readonly description?: string;
	readonly input?: "file" | "folder";
	readonly binary?: string;
}

/** The JSON Schema object produced by Zod v4's toJSONSchema() for a module's schema. */
export interface ModuleJsonSchema {
	readonly type?: string;
	readonly properties?: Readonly<Record<string, ModuleJsonSchemaProperty>>;
	readonly required?: ReadonlyArray<string>;
}

export interface LoadPackageModulesInput {
	readonly loadEntryPath: string;
	readonly packageName: string;
	readonly packageVersion: string;
}

export interface LoadedModuleInfo {
	readonly moduleName: string;
	readonly moduleDescription: string;
	readonly schema: ModuleJsonSchema;
	readonly category: "source" | "transform" | "target";
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
