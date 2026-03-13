export interface JsonSchemaProperty {
	readonly type?: string;
	readonly description?: string;
	readonly default?: unknown;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly multipleOf?: number;
	readonly enum?: ReadonlyArray<string>;
	readonly input?: "file" | "folder";
	readonly mode?: "open" | "save";
	readonly accept?: string;
	readonly binary?: string;
	readonly download?: string;
}

export interface JsonSchema {
	readonly type?: string;
	readonly properties?: Record<string, JsonSchemaProperty>;
}

export function getProperties(schema: unknown): Record<string, JsonSchemaProperty> | undefined {
	const js = schema as JsonSchema | undefined;
	if (js?.type === "object" && js.properties) return js.properties;
	return undefined;
}
