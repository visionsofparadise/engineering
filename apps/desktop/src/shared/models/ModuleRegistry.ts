import type { AudioChainModule } from "@engineering/acm";
import type { z } from "zod";

export interface ModuleClass {
	readonly moduleName: string;
	readonly moduleDescription: string;
	readonly schema: z.ZodType;
	new (properties?: Record<string, unknown>): AudioChainModule;
}

export type ModuleRegistry = ReadonlyMap<string, ReadonlyMap<string, ModuleClass>>;
