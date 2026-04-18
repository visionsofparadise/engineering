import type { z } from "zod";

/**
 * One rendered row of the generated Markdown parameter table.
 *
 * Columns correspond to: `| Parameter | Type | Default | Description |`.
 */
export interface Row {
	name: string;
	type: string;
	default: string;
	description: string;
}

/**
 * Aggregated metadata collected by walking `optional`/`default` wrappers down
 * to an underlying schema type.
 */
interface Unwrapped {
	schema: z.ZodType;
	optional: boolean;
	defaultValue: unknown;
	hasDefault: boolean;
	description: string | undefined;
	meta: Record<string, unknown> | undefined;
}

/**
 * Convert a Zod v4 schema into flat Markdown table rows.
 *
 * The surface of Zod v4 used here is encapsulated in this module so future
 * upgrades have one place to fix. Runtime introspection goes through
 * `schema._zod.def.*` for values that do not have public getters, and public
 * getters (`.shape`, `.options`, `.description`, `.meta()`, `.unwrap()`)
 * elsewhere.
 *
 * @param schema - Top-level Zod schema describing a node's parameters. Object
 *   schemas are flattened into one row per leaf key. Array schemas produce one
 *   row for the array followed by rows for the element shape with an `[]`
 *   suffix in the path. Primitives produce a single row with an empty name
 *   (the caller typically passes an object at the top level).
 * @param prefix - Path prefix used when recursing into nested objects/arrays.
 *   Callers pass `""` (the default) at the top level.
 * @returns Array of `Row` values in document order.
 */
export function zodToRows(schema: z.ZodType, prefix = ""): Array<Row> {
	const rows: Array<Row> = [];
	const unwrapped = unwrap(schema);
	const def = getDef(unwrapped.schema);

	if (def.type === "object") {
		const shape = getShape(unwrapped.schema);

		for (const key of Object.keys(shape)) {
			const fieldSchema = shape[key];

			if (!fieldSchema) continue;

			const fieldPath = prefix === "" ? key : `${prefix}.${key}`;

			appendRows(rows, fieldPath, fieldSchema);
		}

		return rows;
	}

	// Non-object top-level: emit a single row for the whole schema.
	appendRows(rows, prefix, schema);

	return rows;
}

/**
 * Emit rows for a single field located at `path`. For object and array fields
 * this recurses so that nested shapes flatten into the same table.
 */
function appendRows(rows: Array<Row>, path: string, schema: z.ZodType): void {
	const unwrapped = unwrap(schema);
	const def = getDef(unwrapped.schema);

	if (def.type === "object") {
		rows.push(makeRow(path, "Object", unwrapped));

		const shape = getShape(unwrapped.schema);

		for (const key of Object.keys(shape)) {
			const child = shape[key];

			if (!child) continue;

			appendRows(rows, `${path}.${key}`, child);
		}

		return;
	}

	if (def.type === "array") {
		const element = def.element as z.ZodType;
		const elementUnwrapped = unwrap(element);
		const elementDef = getDef(elementUnwrapped.schema);
		const arrayTypeLabel = elementDef.type === "object" ? "Object[]" : `${primitiveTypeLabel(elementUnwrapped)}[]`;

		rows.push(makeRow(path, arrayTypeLabel, unwrapped));

		if (elementDef.type === "object") {
			const shape = getShape(elementUnwrapped.schema);

			for (const key of Object.keys(shape)) {
				const child = shape[key];

				if (!child) continue;

				appendRows(rows, `${path}[].${key}`, child);
			}
		}

		return;
	}

	rows.push(makeRow(path, primitiveTypeLabel(unwrapped), unwrapped));
}

/**
 * Build a finished `Row` from a resolved field path, pre-computed type label,
 * and the collected wrapper metadata for the field.
 */
function makeRow(path: string, baseType: string, unwrapped: Unwrapped): Row {
	const typeLabel = unwrapped.optional && !unwrapped.hasDefault ? `${baseType}, optional` : baseType;
	const defaultString = unwrapped.hasDefault ? `\`${stringifyDefault(unwrapped.defaultValue)}\`` : "—";
	const description = renderDescription(unwrapped);

	return {
		name: path,
		type: typeLabel,
		default: defaultString,
		description,
	};
}

/**
 * Walk through `optional` and `default` wrapper schemas, collecting flags and
 * metadata along the way. The resulting `schema` is the innermost concrete
 * type (object, array, number, string, boolean, enum).
 */
function unwrap(schema: z.ZodType): Unwrapped {
	let current: z.ZodType = schema;
	let optional = false;
	let hasDefault = false;
	let defaultValue: unknown;
	let description = readDescription(current);
	let meta = readMeta(current);

	// Walk through `optional` and `default` wrappers. Both expose `.unwrap()`.
	for (;;) {
		const def = getDef(current);
		const isOptional = def.type === "optional";
		const isDefault = def.type === "default";

		if (!isOptional && !isDefault) break;

		if (isOptional) optional = true;

		if (isDefault) {
			hasDefault = true;
			defaultValue = readDefaultValue(current);
		}

		const next = callUnwrap(current);

		if (!next) break;

		current = next;
		description = description ?? readDescription(current);
		meta = meta ?? readMeta(current);
	}

	return { schema: current, optional, hasDefault, defaultValue, description, meta };
}

/**
 * Render the primitive portion of a type label (the caller composes `[]` and
 * `, optional` suffixes around this). Accepts the unwrapped schema so callers
 * can reuse metadata collected during the wrapper walk.
 */
function primitiveTypeLabel(unwrapped: Unwrapped): string {
	const def = getDef(unwrapped.schema);

	if (def.type === "number") {
		const constraints = numberConstraints(unwrapped.schema);

		return constraints === null ? "number" : `number (${constraints})`;
	}

	if (def.type === "string") return "string";
	if (def.type === "boolean") return "boolean";

	if (def.type === "enum") {
		const options = (unwrapped.schema as unknown as { options: ReadonlyArray<string> }).options;

		return options.map((value) => `"${value}"`).join(" \\| ");
	}

	if (def.type === "union") {
		const literalLabels = unionLiteralLabels(unwrapped.schema);

		if (literalLabels !== null) return literalLabels.join(" \\| ");
	}

	if (def.type === "literal") {
		return literalLabelsForSchema(unwrapped.schema)?.join(" \\| ") ?? def.type;
	}

	// Fallback — unknown leaf type. Surface the def type so the generator
	// output flags it rather than silently rendering an empty label.
	return def.type;
}

/**
 * When a union's members are all `z.literal(...)` values, render them as a
 * pipe-separated literal-type label (e.g. `16 \| 24` or `"a" \| "b"`). Returns
 * `null` when any member is not a literal — the caller then falls back.
 */
function unionLiteralLabels(schema: z.ZodType): Array<string> | null {
	const def = (schema as unknown as { _zod: { def: { options?: ReadonlyArray<z.ZodType> } } })._zod.def;
	const options = def.options;

	if (!options) return null;

	const labels: Array<string> = [];

	for (const option of options) {
		const optionLabels = literalLabelsForSchema(option);

		if (!optionLabels) return null;

		for (const label of optionLabels) labels.push(label);
	}

	return labels;
}

/**
 * Render `z.literal(...)` values as column labels. In Zod v4 a single literal
 * schema carries an array of values (to support `z.literal([a, b])`); each is
 * quoted when it's a string and stringified raw otherwise.
 */
function literalLabelsForSchema(schema: z.ZodType): Array<string> | null {
	const def = (schema as unknown as { _zod: { def: { type: string; values?: ReadonlyArray<unknown> } } })._zod.def;

	if (def.type !== "literal" || !def.values) return null;

	return def.values.map((value) => (typeof value === "string" ? `"${value}"` : String(value)));
}

/**
 * Render the `(min to max, step N)` suffix for a numeric schema based on its
 * Zod check list. Returns `null` when the number has no min/max/multipleOf
 * check.
 */
function numberConstraints(schema: z.ZodType): string | null {
	const def = getDef(schema);
	const checks = (def.checks ?? []) as ReadonlyArray<{ _zod: { def: { check: string; value: number } } }>;

	let min: number | undefined;
	let max: number | undefined;
	let step: number | undefined;

	for (const check of checks) {
		const checkDef = check._zod.def;

		if (checkDef.check === "greater_than") min = checkDef.value;
		else if (checkDef.check === "less_than") max = checkDef.value;
		else if (checkDef.check === "multiple_of") step = checkDef.value;
	}

	const parts: Array<string> = [];

	if (min !== undefined && max !== undefined) {
		parts.push(`${String(min)} to ${String(max)}`);
	}
	else if (min !== undefined) {
		parts.push(`min ${String(min)}`);
	}
	else if (max !== undefined) {
		parts.push(`max ${String(max)}`);
	}

	if (step !== undefined) parts.push(`step ${String(step)}`);

	return parts.length === 0 ? null : parts.join(", ");
}

/**
 * Compose the description column: base description plus an appended download
 * link when the field carries `.meta({ download, binary })`.
 */
function renderDescription(unwrapped: Unwrapped): string {
	const base = unwrapped.description ?? "";
	const meta = unwrapped.meta;

	if (meta && typeof meta.download === "string" && typeof meta.binary === "string") {
		const suffix = ` Download: [${meta.binary}](${meta.download})`;

		return base === "" ? suffix.trimStart() : `${base}${suffix}`;
	}

	return base;
}

/**
 * Serialise a default value for inline rendering in the Default column. Primitives
 * use `String()`; objects/arrays/strings use `JSON.stringify` so the rendered
 * table shows something like `"peaking"` or `[]` verbatim.
 */
function stringifyDefault(value: unknown): string {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "object") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	if (value === undefined) return "undefined";

	// symbol, function — fall back to JSON representation (returns "undefined"
	// when serialisation fails, which is rare for a Zod default value).
	return JSON.stringify(value);
}

/** Access the `_zod.def` escape hatch in a single typed location. */
function getDef(schema: z.ZodType): { type: string; checks?: unknown; element?: unknown } {
	const raw = (schema as unknown as { _zod: { def: { type: string; checks?: unknown; element?: unknown } } })._zod.def;

	return raw;
}

/** Read the `.description` public getter. Returns `undefined` when unset. */
function readDescription(schema: z.ZodType): string | undefined {
	const description = (schema as unknown as { description?: string | undefined }).description;

	return typeof description === "string" ? description : undefined;
}

/** Invoke the `.meta()` public getter when available. */
function readMeta(schema: z.ZodType): Record<string, unknown> | undefined {
	const candidate = (schema as unknown as { meta?: () => Record<string, unknown> | undefined }).meta;

	if (typeof candidate !== "function") return undefined;

	const value = candidate.call(schema);

	return value ?? undefined;
}

/** Read the `_zod.def.defaultValue` off a `ZodDefault`. */
function readDefaultValue(schema: z.ZodType): unknown {
	const def = (schema as unknown as { _zod: { def: { defaultValue?: unknown } } })._zod.def;

	return def.defaultValue;
}

/** Call `.unwrap()` when the schema exposes it (optional/default wrappers). */
function callUnwrap(schema: z.ZodType): z.ZodType | undefined {
	const candidate = (schema as unknown as { unwrap?: () => z.ZodType }).unwrap;

	if (typeof candidate !== "function") return undefined;

	return candidate.call(schema);
}

/** Read `.shape` on a `ZodObject`. */
function getShape(schema: z.ZodType): Record<string, z.ZodType> {
	return (schema as unknown as { shape: Record<string, z.ZodType> }).shape;
}
