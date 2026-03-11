import type { ChainDefinition } from "@engineering/acm";
import { useCallback, useRef, useState } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { AppState } from "../../../models/State/App";
import { ChainSlot } from "./ChainSlot";
import { ModuleMenu, type ModuleSelection } from "./ModuleMenu";

interface ChainSlotsProps {
	readonly app: Snapshot<AppState>;
	readonly chain: ChainDefinition;
	readonly setChain: (updater: (chain: ChainDefinition) => ChainDefinition) => void;
	readonly disabled?: boolean;
}

export const ChainSlots: React.FC<ChainSlotsProps> = ({ app, chain, setChain, disabled }) => {
	const transforms = chain.transforms;
	const [dragIndex, setDragIndex] = useState<number | undefined>(undefined);
	const dragOverIndex = useRef<number | undefined>(undefined);

	const handleRemove = useCallback(
		(index: number) => {
			setChain((current) => ({ ...current, transforms: current.transforms.filter((_, position) => position !== index) }));
		},
		[setChain],
	);

	const handleAdd = useCallback(
		(selection: ModuleSelection) => {
			setChain((current) => ({ ...current, transforms: [...current.transforms, { package: selection.packageName, module: selection.moduleName }] }));
		},
		[setChain],
	);

	const handleDragStart = useCallback((index: number) => {
		setDragIndex(index);
	}, []);

	const handleDragOver = useCallback((event: React.DragEvent, index: number) => {
		event.preventDefault();
		dragOverIndex.current = index;
	}, []);

	const handleDrop = useCallback(() => {
		const targetIndex = dragOverIndex.current;
		if (dragIndex !== undefined && targetIndex !== undefined && dragIndex !== targetIndex) {
			setChain((current) => {
				const updated = [...current.transforms];
				const [moved] = updated.splice(dragIndex, 1);
				if (moved) updated.splice(targetIndex, 0, moved);
				return { ...current, transforms: updated };
			});
		}
		setDragIndex(undefined);
		dragOverIndex.current = undefined;
	}, [dragIndex, setChain]);

	return (
		<div className="flex flex-col gap-1 p-2">
			{transforms.map((transform, index) => (
				<div
					key={`${transform.module}-${index}`}
					draggable={!disabled}
					onDragStart={() => handleDragStart(index)}
					onDragOver={(event) => handleDragOver(event, index)}
					onDrop={handleDrop}
				>
					<ChainSlot
						packageName={transform.package}
						module={transform.module}
						index={index}
						app={app}
						disabled={disabled}
						onRemove={() => handleRemove(index)}
						chain={chain}
						setChain={setChain}
					/>
				</div>
			))}
			{!disabled && <ModuleMenu app={app} onSelect={handleAdd} />}
		</div>
	);
};
