import type { LeafParameter, Parameter } from "../utils/buildParameters";
import { ArrayRow } from "./Array";
import { BooleanRow } from "./Boolean";
import { EnumRow } from "./Enum";
import { FileRow } from "./File";
import { NumberRow } from "./Number";
import { ObjectRow } from "./Object";
import { StringRow } from "./String";

/**
 * Callbacks passed through the recursive parameter renderer.
 * All are optional — missing callbacks disable the relevant controls.
 */
export interface ParameterCallbacks {
	/** Called when any leaf value changes. Path is [topLevelName, ...nested]. */
	readonly onParameterChangeAtPath?: (path: ReadonlyArray<string | number>, value: unknown) => void;
	/** Called when a file/folder leaf requests a browse dialog. */
	readonly onParameterBrowseAtPath?: (path: ReadonlyArray<string | number>) => void;
	/** Called when a new array row should be appended. */
	readonly onArrayRowAdd?: (paramName: string) => void;
	/** Called when an array row should be removed. */
	readonly onArrayRowDelete?: (paramName: string, rowIndex: number) => void;
	/** Called when array rows should be reordered. */
	readonly onArrayRowReorder?: (paramName: string, fromIndex: number, toIndex: number) => void;
	/** When true, number knobs render as disabled (no callbacks available). */
	readonly disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Leaf dispatcher — renders a single leaf parameter without path context
// ---------------------------------------------------------------------------

/**
 * Renders a single leaf parameter.
 * Used by ArrayRow to render row fields with pre-computed callbacks.
 */
export function LeafField({
	param,
	dimmed,
	disabled,
	onParameterChange,
	onParameterBrowse,
}: {
	readonly param: LeafParameter;
	readonly dimmed?: boolean;
	readonly disabled?: boolean;
	readonly onParameterChange?: (name: string, value: unknown) => void;
	readonly onParameterBrowse?: (name: string) => void;
}) {
	switch (param.kind) {
		case "number":
			return (
				<NumberRow
					param={param}
					dimmed={dimmed}
					disabled={disabled}
					onParameterChange={onParameterChange}
				/>
			);

		case "boolean":
			return (
				<BooleanRow
					param={param}
					dimmed={dimmed}
					onParameterChange={onParameterChange}
				/>
			);

		case "enum":
			return (
				<EnumRow
					param={param}
					dimmed={dimmed}
					onParameterChange={onParameterChange}
				/>
			);

		case "file":
			return (
				<FileRow
					param={param}
					dimmed={dimmed}
					onParameterBrowse={onParameterBrowse}
				/>
			);

		case "string":
			return (
				<StringRow
					param={param}
					dimmed={dimmed}
					onParameterChange={onParameterChange}
				/>
			);
	}
}

// ---------------------------------------------------------------------------
// Recursive dispatcher
// ---------------------------------------------------------------------------

/**
 * Recursive parameter renderer. Dispatches on Parameter kind and passes
 * path context down to leaf controls so they emit the correct path.
 */
export function ParameterField({
	param,
	basePath,
	dimmed,
	callbacks,
}: {
	readonly param: Parameter;
	readonly basePath: ReadonlyArray<string | number>;
	readonly dimmed?: boolean;
	readonly callbacks: ParameterCallbacks;
}) {
	switch (param.kind) {
		case "object":
			return (
				<ObjectRow
					param={param}
					basePath={basePath}
					dimmed={dimmed}
					callbacks={callbacks}
				/>
			);

		case "array":
			return (
				<ArrayRow
					param={param}
					dimmed={dimmed}
					callbacks={callbacks}
				/>
			);

		default: {
			// Leaf parameter — build path-aware callbacks
			const leafPath = [...basePath, param.name];

			return (
				<LeafField
					param={param}
					dimmed={dimmed}
					disabled={callbacks.disabled}
					onParameterChange={(_, value) => {
						callbacks.onParameterChangeAtPath?.(leafPath, value);
					}}
					onParameterBrowse={() => {
						callbacks.onParameterBrowseAtPath?.(leafPath);
					}}
				/>
			);
		}
	}
}
