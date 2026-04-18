import {
	DndContext,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
	type DragEndEvent,
} from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { ArrayParameter, LeafParameter } from "../utils/buildParameters";
import type { ParameterCallbacks } from "./ParameterField";
import { LeafField } from "./ParameterField";

// ---------------------------------------------------------------------------
// Sortable row
// ---------------------------------------------------------------------------

function SortableArrayRow({
	rowId,
	rowIndex,
	paramName,
	fields,
	dimmed,
	callbacks,
}: {
	readonly rowId: string;
	readonly rowIndex: number;
	readonly paramName: string;
	readonly fields: ReadonlyArray<LeafParameter>;
	readonly dimmed?: boolean;
	readonly callbacks: ParameterCallbacks;
}) {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rowId });

	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="flex flex-col gap-2 bg-chrome-base py-2 pl-2 pr-1"
		>
			<div className="flex items-center justify-between">
				{/* Drag handle — noDrag prevents React Flow from intercepting pointer events */}
				<div
					className="noDrag flex cursor-grab items-center text-chrome-text-dim active:cursor-grabbing"
					{...attributes}
					{...listeners}
				>
					<GripVertical size={12} />
				</div>

				{/* Delete row */}
				<button
					type="button"
					className="noDrag flex items-center text-chrome-text-dim hover:text-state-error"
					onClick={() => callbacks.onArrayRowDelete?.(paramName, rowIndex)}
				>
					<Trash2 size={12} />
				</button>
			</div>

			{/* Row fields */}
			{fields.map((field) => (
				<LeafField
					key={field.name}
					param={field}
					dimmed={dimmed}
					disabled={callbacks.disabled}
					onParameterChange={(fieldName, value) => {
						callbacks.onParameterChangeAtPath?.([paramName, rowIndex, fieldName], value);
					}}
					onParameterBrowse={(fieldName) => {
						callbacks.onParameterBrowseAtPath?.([paramName, rowIndex, fieldName]);
					}}
				/>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Array editor
// ---------------------------------------------------------------------------

export function ArrayRow({
	param,
	dimmed,
	callbacks,
}: {
	readonly param: ArrayParameter;
	readonly dimmed?: boolean;
	readonly callbacks: ParameterCallbacks;
}) {
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 6 },
		}),
	);

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		if (!over || active.id === over.id) return;

		const fromIndex = param.rows.findIndex((row) => row.rowId === active.id);
		const toIndex = param.rows.findIndex((row) => row.rowId === over.id);

		if (fromIndex === -1 || toIndex === -1) return;

		callbacks.onArrayRowReorder?.(param.name, fromIndex, toIndex);
	};

	return (
		<div className="flex flex-col gap-1">
			<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">
				{param.name}
			</span>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragEnd={handleDragEnd}
			>
				<SortableContext
					items={param.rows.map((row) => row.rowId)}
					strategy={verticalListSortingStrategy}
				>
					<div className="flex flex-col gap-1">
						{param.rows.map((row, rowIndex) => (
							<SortableArrayRow
								key={row.rowId}
								rowId={row.rowId}
								rowIndex={rowIndex}
								paramName={param.name}
								fields={row.fields}
								dimmed={dimmed}
								callbacks={callbacks}
							/>
						))}
					</div>
				</SortableContext>
			</DndContext>

			<button
				type="button"
				className="noDrag mt-1 flex items-center gap-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim hover:text-chrome-text"
				onClick={() => callbacks.onArrayRowAdd?.(param.name)}
			>
				<Plus size={10} />
				Add
			</button>
		</div>
	);
}
