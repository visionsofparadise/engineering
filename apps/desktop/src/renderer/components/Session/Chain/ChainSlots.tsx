import { useCallback, useRef, useState } from "react";
import { useSaveChain } from "../../../hooks/useChain";
import type { SessionContext } from "../../../models/Context";
import { ChainSlot } from "./ChainSlot";

interface ChainSlotsProps {
	readonly context: SessionContext;
}

export const ChainSlots: React.FC<ChainSlotsProps> = ({ context }) => {
	const { chain, sessionPath } = context;
	const transforms = chain.transforms;
	const saveChain = useSaveChain(sessionPath);
	const [dragIndex, setDragIndex] = useState<number | undefined>(undefined);
	const dragOverIndex = useRef<number | undefined>(undefined);

	const handleRemove = useCallback(
		(index: number) => {
			const updated = transforms.filter((_, position) => position !== index);
			saveChain.mutate({ ...chain, transforms: updated });
		},
		[chain, transforms, saveChain],
	);

	const handleDragStart = useCallback((index: number) => {
		setDragIndex(index);
	}, []);

	const handleDragOver = useCallback((event: React.DragEvent, index: number) => {
		event.preventDefault();
		dragOverIndex.current = index;
	}, []);

	const handleDrop = useCallback(() => {
		if (dragIndex !== undefined && dragOverIndex.current !== undefined && dragIndex !== dragOverIndex.current) {
			const updated = [...transforms];
			const [moved] = updated.splice(dragIndex, 1);
			if (moved) updated.splice(dragOverIndex.current, 0, moved);
			saveChain.mutate({ ...chain, transforms: updated });
		}
		setDragIndex(undefined);
		dragOverIndex.current = undefined;
	}, [dragIndex, transforms, chain, saveChain]);

	if (transforms.length === 0) {
		return (
			<div className="flex items-center justify-center p-4">
				<p className="text-xs text-muted-foreground">No modules added</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1 p-2">
			{transforms.map((transform, index) => (
				<div
					key={`${transform.module}-${index}`}
					onDragStart={() => handleDragStart(index)}
					onDragOver={(event) => handleDragOver(event, index)}
					onDrop={handleDrop}
				>
					<ChainSlot
						module={transform.module}
						index={index}
						onRemove={() => handleRemove(index)}
						context={context}
					/>
				</div>
			))}
		</div>
	);
};
