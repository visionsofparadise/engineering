import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";

export const ChainSlots: React.FC = () => (
	<div className="flex h-full flex-col">
		<div className="flex items-center justify-between border-b border-border px-3 py-2">
			<span className="text-xs font-medium text-muted-foreground">Chain</span>
		</div>
		<ScrollArea className="flex-1">
			<div className="flex items-center justify-center p-4">
				<p className="text-xs text-muted-foreground">No modules added</p>
			</div>
		</ScrollArea>
		<div className="flex justify-end border-t border-border px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				className="h-7 text-xs"
				disabled
			>
				Apply All
			</Button>
		</div>
	</div>
);
