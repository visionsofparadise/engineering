import { resnapshot } from "../../models/ProxyStore/resnapshot";
import type { ChainModuleReference } from "audio-chain-module";
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useMemo } from "react";
import type { IdentifiedChain } from "../../hooks/useChain";
import type { AppContext } from "../../models/Context";
import { ChainSlot } from "../Session/Chain/ChainSlot";
import { ADD_MODULE_TRIGGER_CLASS, ModuleMenu } from "../Session/Chain/ModuleMenu";

interface BatchChainProps {
	readonly context: AppContext;
	readonly disabled: boolean;
}

export const BatchChain: React.FC<BatchChainProps> = resnapshot(({ context, disabled }) => {
	const { app, appStore } = context;

	const chain: IdentifiedChain = useMemo(
		() => ({
			transforms: (app.batch.transforms as Array<ChainModuleReference>).map((transform) => ({ ...transform, id: crypto.randomUUID() })),
		}),
		[app.batch.transforms],
	);

	const setChain = useCallback(
		(updater: (c: IdentifiedChain) => IdentifiedChain) => {
			const updated = updater(chain);
			appStore.mutate(app, (proxy) => {
				proxy.batch.transforms = updated.transforms.map(({ id: _, ...rest }) => rest) as Array<ChainModuleReference>;
			});
		},
		[app, appStore, chain],
	);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			if (!result.destination || result.source.index === result.destination.index) return;

			const from = result.source.index;
			const to = result.destination.index;
			const item = chain.transforms[from];
			if (!item) return;

			const without = [...chain.transforms.slice(0, from), ...chain.transforms.slice(from + 1)];
			const reordered = [...without.slice(0, to), item, ...without.slice(to)];

			setChain(() => ({ ...chain, transforms: reordered }));
		},
		[chain, setChain],
	);

	return (
		<div className="flex h-full flex-col items-center justify-center px-3">
			<div className="flex w-full flex-col gap-3">
				<DragDropContext onDragEnd={handleDragEnd}>
					<Droppable droppableId="batch-chain-slots">
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
													onRemove={() => {
														setChain((current) => ({
															...current,
															transforms: current.transforms.filter((_, position) => position !== index),
														}));
													}}
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
							onSelect={(selection) => {
								setChain((current) => ({
									...current,
									transforms: [...current.transforms, { id: crypto.randomUUID(), package: selection.packageName, module: selection.moduleName }],
								}));
							}}
							triggerClassName={ADD_MODULE_TRIGGER_CLASS}
							triggerLabel="+ Add Module"
							popoverAlign="center"
							popoverSideOffset={12}
						/>
					</div>
				)}
			</div>
		</div>
	);
});
