import { AudioWaveform } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { useImportFile } from "../hooks/useImportFile";
import type { AppContext } from "../models/Context";

interface FileDropZoneProps {
	readonly context: AppContext;
	readonly children: React.ReactNode;
}

export const FileDropZone: React.FC<FileDropZoneProps> = ({ context, children }) => {
	const [dragging, setDragging] = useState(false);
	const importFile = useImportFile(context);
	const dragCounterRef = useRef(0);

	const handleDragEnter = useCallback((event: DragEvent) => {
		event.preventDefault();
		dragCounterRef.current++;
		if (event.dataTransfer.types.includes("Files")) {
			setDragging(true);
		}
	}, []);

	const handleDragLeave = useCallback((event: DragEvent) => {
		event.preventDefault();
		dragCounterRef.current--;
		if (dragCounterRef.current === 0) {
			setDragging(false);
		}
	}, []);

	const handleDragOver = useCallback((event: DragEvent) => {
		if (!event.dataTransfer.types.includes("Files")) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			event.preventDefault();
			dragCounterRef.current = 0;
			setDragging(false);

			if (!event.dataTransfer.files.length) return;

			const file = event.dataTransfer.files[0];
			if (!file) return;

			const filePath = window.main.getPathForFile(file);
			importFile.mutate(filePath);
		},
		[importFile],
	);

	return (
		<div
			className="relative flex h-screen flex-col"
			onDragEnter={handleDragEnter}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			{children}
			{dragging && (
				<div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
					<div className="flex flex-col items-center gap-3 text-muted-foreground">
						<AudioWaveform className="h-12 w-12 opacity-60" />
						<p className="text-sm font-medium">Drop audio file to open</p>
					</div>
				</div>
			)}
		</div>
	);
};
