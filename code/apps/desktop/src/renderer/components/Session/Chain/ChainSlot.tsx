import type { ChainDefinition } from "@engineering/acm";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui/button";
import { Parameters } from "./Parameters/Parameters";

interface ChainSlotProps {
	readonly module: string;
	readonly index: number;
	readonly onRemove: () => void;
	readonly chain: ChainDefinition;
	readonly setChain: (updater: (chain: ChainDefinition) => ChainDefinition) => void;
	readonly disabled?: boolean;
}

export const ChainSlot: React.FC<ChainSlotProps> = ({ module, index, onRemove, chain, setChain, disabled }) => {
	const [hovered, setHovered] = useState(false);

	return (
		<div
			className="group flex items-center gap-1 rounded border border-border px-2 py-1.5"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			draggable
			data-index={index}
		>
			<span className="flex-1 truncate text-xs">{module}</span>

			<Parameters
				module={module}
				index={index}
				chain={chain}
				setChain={setChain}
				disabled={disabled}
			/>

			{hovered && !disabled && (
				<Button
					variant="ghost"
					size="icon"
					className="h-5 w-5 shrink-0"
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
