import type { z } from "zod";

export interface ZodCheck {
	readonly kind: string;
	readonly value?: number;
}

export interface ZodDef {
	readonly typeName?: string;
	readonly checks?: ReadonlyArray<ZodCheck>;
	readonly innerType?: { _def?: ZodDef; description?: string };
	readonly defaultValue?: unknown;
	readonly values?: ReadonlyArray<string>;
	readonly shape?: () => Record<string, { _def?: ZodDef; description?: string }>;
}

export function getDef(schema: z.ZodType): ZodDef | undefined {
	return (schema as unknown as { _def?: ZodDef })._def;
}

export function getShape(schema: z.ZodType): Record<string, { _def?: ZodDef; description?: string }> | undefined {
	const def = getDef(schema);
	if (def?.typeName === "ZodObject" && typeof def.shape === "function") return def.shape();
	return undefined;
}

export function getCheck(checks: ReadonlyArray<ZodCheck>, kind: string): number | undefined {
	return checks.find((check) => check.kind === kind)?.value;
}

export function unwrapDefault(def: ZodDef): { def: ZodDef; defaultValue: unknown; label: string | undefined } {
	if (def.typeName === "ZodDefault" && def.innerType?._def) {
		return { def: def.innerType._def, defaultValue: def.defaultValue, label: def.innerType.description };
	}
	return { def, defaultValue: undefined, label: undefined };
}
