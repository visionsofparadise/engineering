import { AudioWaveform } from "lucide-react";
import { Button } from "../ui/button";

interface EmptyStateProps {
	readonly onOpen?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onOpen }) => (
	<div className="flex h-full w-full items-center justify-center surface-panel">
		<div className="flex flex-col items-center gap-3 text-muted-foreground">
			<AudioWaveform className="h-8 w-8 opacity-40" />
			<p className="text-sm">Drop an audio file here to get started</p>
			{onOpen && (
				<Button
					variant="outline"
					size="sm"
					className="text-xs"
					onClick={onOpen}
				>
					Open File
				</Button>
			)}
		</div>
	</div>
);
