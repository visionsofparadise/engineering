import type { GraphNode } from "@e9g/buffered-audio-nodes-core";
import type { ModuleJsonSchema } from "../../../../../../shared/ipc/Package/loadModules/Renderer";
import type { BooleanParameter } from "../ParameterRow/Boolean";
import type { EnumParameter } from "../ParameterRow/Enum";
import type { FileParameter } from "../ParameterRow/File";
import type { NumberParameter } from "../ParameterRow/Number";
import type { StringParameter } from "../ParameterRow/String";

export type Parameter = NumberParameter | BooleanParameter | EnumParameter | StringParameter | FileParameter;

export function buildParameters(graphNode: GraphNode, moduleSchema: ModuleJsonSchema | null, binaryDefaults: Record<string, string>): Array<Parameter> {
	if (!moduleSchema?.properties) return [];

	const parameters: Array<Parameter> = [];

	for (const [propertyName, prop] of Object.entries(moduleSchema.properties)) {
		const currentValue = graphNode.parameters?.[propertyName] ?? prop.default;

		if (prop.enum) {
			const enumValue = typeof currentValue === "string" ? currentValue : (prop.enum[0] ?? "");

			parameters.push({
				kind: "enum",
				name: propertyName,
				value: enumValue,
				options: [...prop.enum],
			});
			continue;
		}

		switch (prop.type) {
			case "number": {
				parameters.push({
					kind: "number",
					name: propertyName,
					value: typeof currentValue === "number" ? currentValue : 0,
					min: prop.minimum ?? 0,
					max: prop.maximum ?? 1,
					step: prop.multipleOf ?? 0.01,
					unit: prop.description ?? "",
				});
				break;
			}

			case "boolean": {
				parameters.push({
					kind: "boolean",
					name: propertyName,
					value: typeof currentValue === "boolean" ? currentValue : false,
				});
				break;
			}

			case "string": {
				if (prop.input === "file" || prop.input === "folder") {
					let fileValue = typeof currentValue === "string" ? currentValue : "";

					if (prop.binary && !fileValue) {
						fileValue = binaryDefaults[prop.binary] ?? "";
					}

					parameters.push({
						kind: "file",
						name: propertyName,
						value: fileValue,
					});
				} else {
					parameters.push({
						kind: "string",
						name: propertyName,
						value: typeof currentValue === "string" ? currentValue : "",
					});
				}

				break;
			}

			default: {
				console.warn(`buildParameters: unknown type "${prop.type}" for property "${propertyName}"`);
				break;
			}
		}
	}

	return parameters;
}
