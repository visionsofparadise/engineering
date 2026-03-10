import { Download, Play, SkipBack, Square } from "lucide-react";
import { Button } from "../ui/button";

export const Transport: React.FC = () => (
	<div className="flex h-12 items-center border-t border-border px-4">
		<div className="flex-1" />

		<div className="flex items-center gap-1">
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8"
				disabled
			>
				<SkipBack className="h-4 w-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8"
				disabled
			>
				<Play className="h-4 w-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="h-8 w-8"
				disabled
			>
				<Square className="h-4 w-4" />
			</Button>
		</div>

		<div className="flex flex-1 justify-end">
			<Button
				variant="ghost"
				size="sm"
				className="h-8 gap-1 text-xs"
				disabled
			>
				<Download className="h-4 w-4" />
				Export
			</Button>
		</div>
	</div>
);
