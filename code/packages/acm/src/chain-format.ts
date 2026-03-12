import { z } from "zod";

const chainModuleReferenceSchema = z.object({
	package: z.string().min(1),
	module: z.string().min(1),
	label: z.string().optional(),
	options: z.record(z.string(), z.unknown()).optional(),
});

const chainDefinitionSchema = z.object({
	label: z.string().optional(),
	transforms: z.array(chainModuleReferenceSchema),
});

export type ChainModuleReference = z.infer<typeof chainModuleReferenceSchema>;
export type ChainDefinition = z.infer<typeof chainDefinitionSchema>;

export function validateChainDefinition(json: unknown): ChainDefinition {
	const chain = chainDefinitionSchema.parse(json);

	// Migrate legacy package names
	for (const transform of chain.transforms) {
		if (transform.package === "acm-engineering") {
			transform.package = "acm";
		}
	}

	return chain;
}
