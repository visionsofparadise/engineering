import { Icon } from "@iconify/react";
import { Button } from "@e9g/design-system";

interface Props {
	readonly onAddNode: () => void;
}

export function BottomRightOverlay({ onAddNode }: Props) {
	return (
		<div className="absolute bottom-3 right-3 z-10">
			<Button variant="primary" size="xl" onClick={onAddNode}>
				<span className="flex items-center gap-2">
					<Icon icon="lucide:plus" width={16} height={16} />
					<span>Add Node</span>
				</span>
			</Button>
		</div>
	);
}
