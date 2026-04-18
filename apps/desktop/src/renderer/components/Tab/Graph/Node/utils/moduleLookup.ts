import type { ModuleJsonSchema, ModuleJsonSchemaProperty } from "../../../../../../shared/ipc/Package/loadModules/Renderer";
import type { GraphContext } from "../../../../../models/Context";
import type { NodeCategory } from "../Container";

/**
 * Resolve a package module by (packageName, packageVersion, nodeName) from the
 * graph context. Returns a tuple of { category, moduleDescription, schema }.
 *
 * Generic — not coupled to any particular renderer component.
 */
export function lookupModule(
	context: GraphContext,
	packageName: string,
	packageVersion: string,
	nodeName: string,
): { category: NodeCategory; moduleDescription: string; schema: ModuleJsonSchema | null } {
	for (const modulePackage of context.app.packages) {
		if (modulePackage.name === packageName && modulePackage.version === packageVersion) {
			for (const mod of modulePackage.modules) {
				if (mod.moduleName === nodeName) {
					return {
						category: mod.category,
						moduleDescription: mod.moduleDescription,
						schema: mod.schema as ModuleJsonSchema,
					};
				}
			}
		}
	}

	return { category: "transform", moduleDescription: "", schema: null };
}

/**
 * Traverse a JSON Schema to find the property at the given path.
 * path[0] is the top-level parameter name; subsequent segments are property
 * names (string) or array item schema indicators (number — always resolves
 * to `items`).
 */
export function schemaPropertyAtPath(
	schema: ModuleJsonSchema | null,
	path: ReadonlyArray<string | number>,
): ModuleJsonSchemaProperty | null {
	if (!schema?.properties || path.length === 0) return null;

	const [head, ...tail] = path;

	if (typeof head !== "string") return null;

	let current: ModuleJsonSchemaProperty | undefined = schema.properties[head];

	for (const segment of tail) {
		if (!current) return null;

		if (typeof segment === "number") {
			// Array index — resolve to items schema
			current = current.items;
		} else {
			// Object property
			current = current.properties?.[segment];
		}
	}

	return current ?? null;
}
