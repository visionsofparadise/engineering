import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useCallback } from "react";
import type { IdentifiedChain } from "../../../hooks/useChain";
import type { AppContext } from "../../../models/Context";
import { ChainSlot } from "./ChainSlot";
import { ADD_MODULE_TRIGGER_CLASS, ModuleMenu, type ModuleSelection } from "./ModuleMenu";

interface ChainSlotsProps {
	readonly context: AppContext;
	readonly chain: IdentifiedChain;
	readonly setChain: (updater: (chain: IdentifiedChain) => IdentifiedChain) => void;
	readonly disabled?: boolean;
}

export const ChainSlots: React.FC<ChainSlotsProps> = ({ context, chain, setChain, disabled }) => {
	const handleRemove = useCallback(
		(index: number) => {
			setChain((current) => ({ ...current, transforms: current.transforms.filter((_, position) => position !== index) }));
		},
		[setChain],
	);

	const handleAdd = useCallback(
		(selection: ModuleSelection) => {
			setChain((current) => ({
				...current,
				transforms: [...current.transforms, { id: crypto.randomUUID(), package: selection.packageName, module: selection.moduleName }],
			}));
		},
		[setChain],
	);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			if (!result.destination || result.source.index === result.destination.index) return;

			const from = result.source.index;
			const to = result.destination.index;

			setChain((current) => {
				const item = current.transforms[from];
				if (!item) return current;

				const without = [...current.transforms.slice(0, from), ...current.transforms.slice(from + 1)];
				const reordered = [...without.slice(0, to), item, ...without.slice(to)];

				return { ...current, transforms: reordered };
			});
		},
		[setChain],
	);

	return (
		<div className="flex flex-col items-center gap-3">
			<DragDropContext onDragEnd={handleDragEnd}>
				<Droppable droppableId="chain-slots">
					{(provided) => (
						<div
							ref={provided.innerRef}
							{...provided.droppableProps}
							className="flex w-full flex-col gap-3"
						>
							{chain.transforms.map((transform, index) => (
								<Draggable
									key={transform.id}
									draggableId={transform.id}
									index={index}
									isDragDisabled={disabled}
								>
									{(provided) => (
										<div
											ref={provided.innerRef}
											{...provided.draggableProps}
											className="relative z-10 w-full"
										>
											<ChainSlot
												packageName={transform.package}
												module={transform.module}
												index={index}
												context={context}
												disabled={disabled}
												onRemove={() => handleRemove(index)}
												chain={chain}
												setChain={setChain}
												dragHandleProps={provided.dragHandleProps ?? undefined}
											/>
										</div>
									)}
								</Draggable>
							))}
							{provided.placeholder}
						</div>
					)}
				</Droppable>
			</DragDropContext>
			{!disabled && (
				<div className="relative z-10 w-full">
					<ModuleMenu
						app={context.app}
						onSelect={handleAdd}
						triggerClassName={ADD_MODULE_TRIGGER_CLASS}
						triggerLabel="+ Add Module"
						popoverAlign="center"
						popoverSideOffset={12}
					/>
				</div>
			)}
		</div>
	);
};
