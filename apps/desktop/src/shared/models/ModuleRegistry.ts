import type { BufferedAudioNode } from "@e9g/buffered-audio-nodes-core";
import type { z } from "zod";

export interface ModuleClass {
	readonly moduleName: string;
	readonly moduleDescription: string;
	readonly schema: z.ZodType;

	new (properties?: Record<string, unknown>): BufferedAudioNode;
}

export type ModuleRegistry = ReadonlyMap<string, ReadonlyMap<string, ModuleClass>>;

export type ModuleRegistryMap = Map<string, Map<string, ModuleClass>>;

export function createModuleRegistry(): ModuleRegistryMap {
	return new Map();
}

export function registerPackage(registry: ModuleRegistryMap, packageName: string, modules: Map<string, ModuleClass>): void {
	registry.set(packageName, modules);
}

export function unregisterPackage(registry: ModuleRegistryMap, packageName: string): void {
	registry.delete(packageName);
}
