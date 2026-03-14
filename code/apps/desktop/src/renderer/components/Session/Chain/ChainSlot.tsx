import type { DraggableProvidedDragHandleProps } from "@hello-pangea/dnd";
import type { IdentifiedChain } from "../../../hooks/useChain";
import { GripVertical, X } from "lucide-react";
import { useState } from "react";
import type { AppContext } from "../../../models/Context";
import { cn } from "../../../utils/cn";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { Parameters } from "./Parameters/Parameters";

interface ChainSlotProps {
	readonly packageName: string;
	readonly module: string;
	readonly index: number;
	readonly context: AppContext;
	readonly onRemove: () => void;
	readonly chain: IdentifiedChain;
	readonly setChain: (updater: (chain: IdentifiedChain) => IdentifiedChain) => void;
	readonly disabled?: boolean;
	readonly dragHandleProps?: DraggableProvidedDragHandleProps;
}

export const ChainSlot: React.FC<ChainSlotProps> = ({ packageName, module, index, context, onRemove, chain, setChain, disabled, dragHandleProps }) => {
	const [hovered, setHovered] = useState(false);
	const bypassed = chain.transforms[index]?.bypass === true;

	const handleBypass = (checked: boolean) => {
		setChain((current) => ({
			...current,
			transforms: current.transforms.map((transform, position) =>
				position === index ? { ...transform, bypass: !checked } : transform,
			),
		}));
	};

	return (
		<div
			className={cn("relative z-10 flex w-full items-center gap-0 card-outline p-0 transition-colors", bypassed && "opacity-50")}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			{dragHandleProps && !disabled && (
				<div
					{...dragHandleProps}
					className="flex shrink-0 cursor-grab items-center self-stretch pl-1 text-muted-foreground active:cursor-grabbing"
				>
					<GripVertical className="h-4 w-4" />
				</div>
			)}
			<Parameters
				packageName={packageName}
				module={module}
				index={index}
				context={context}
				chain={chain}
				setChain={setChain}
				disabled={disabled}
			>
				<button
					className="flex flex-1 items-center gap-3 px-3 py-3 text-left"
					onPointerDown={(event) => event.stopPropagation()}
				>
					<Switch
						checked={!bypassed}
						onCheckedChange={handleBypass}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}
						disabled={disabled}
					/>
					<span className={cn(
						"flex-1 truncate text-sm font-medium text-card-foreground",
						bypassed && "line-through text-muted-foreground",
					)}>
						{module}
					</span>
				</button>
			</Parameters>

			{hovered && !disabled && (
				<Button
					variant="ghost"
					size="icon"
					className="mr-2 h-6 w-6 shrink-0"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						onRemove();
					}}
				>
					<X className="h-3 w-3" />
				</Button>
			)}
		</div>
	);
};
