import { Music } from "lucide-react";

export const EmptyState: React.FC = () => (
	<div className="flex h-full items-center justify-center surface-panel">
		<div className="flex flex-col items-center gap-2 text-muted-foreground">
			<Music className="h-8 w-8 opacity-40" />
			<p className="text-sm">Open a file to get started</p>
		</div>
	</div>
);
