import type { ModuleClass, ModuleRegistry } from "../shared/models/ModuleRegistry";

// FIX: Don't reexport like this
export type { ModuleClass, ModuleRegistry };

const registry = new Map<string, Map<string, ModuleClass>>();

export function registerPackage(packageName: string, modules: Map<string, ModuleClass>): void {
	registry.set(packageName, modules);
}

export function unregisterPackage(packageName: string): void {
	registry.delete(packageName);
}

export function getRegistry(): ModuleRegistry {
	return registry;
}
