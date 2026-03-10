import { ScrollArea } from "../ui/scroll-area";

export const History: React.FC = () => (
	<div className="flex h-full flex-col">
		<div className="flex items-center border-b border-border px-3 py-2">
			<span className="text-xs font-medium text-muted-foreground">History</span>
		</div>
		<ScrollArea className="flex-1">
			<div className="flex items-center justify-center p-4">
				<p className="text-xs text-muted-foreground">No history</p>
			</div>
		</ScrollArea>
	</div>
);
