import { useCallback, type DragEvent } from "react";
import { basename } from "pathe";
import type { Snapshot } from "valtio/vanilla";
import type { AppContext } from "../../models/Context";
import type { AppState, BatchFile } from "../../models/State/App";
import type { ProxyStore } from "../../models/ProxyStore/ProxyStore";
import { ScrollArea } from "../ui/scroll-area";
import { EmptyState } from "../Session/EmptyState";
import { FileRow } from "./FileRow";

interface FileListProps {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly running: boolean;
	readonly onAbortFile: (index: number) => void;
	readonly context: AppContext;
}

export const FileList: React.FC<FileListProps> = ({ app, appStore, running, onAbortFile, context }) => {
	const files = app.batch.files;

	const setFiles = useCallback(
		(updated: ReadonlyArray<BatchFile>) => {
			appStore.mutate(app, (proxy) => {
				proxy.batch.files = updated as Array<BatchFile>;
			});
		},
		[app, appStore],
	);

	const handleDragOver = useCallback((event: DragEvent) => {
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const handleDrop = useCallback(
		(event: DragEvent) => {
			event.preventDefault();
			event.stopPropagation();
			if (running) return;

			const droppedFiles: Array<BatchFile> = [];
			for (const file of event.dataTransfer.files) {
				const path = window.main.getPathForFile(file);
				droppedFiles.push({ path });
			}

			setFiles([...files, ...droppedFiles]);
		},
		[files, setFiles, running],
	);

	const handleAddFiles = useCallback(async () => {
		const paths = await context.main.showOpenDialog({
			title: "Add Files",
			filters: [{ name: "Audio Files", extensions: ["wav", "flac", "mp3", "m4a", "aac", "ogg"] }],
			properties: ["openFile", "multiSelections"],
		});

		if (!paths || paths.length === 0) return;

		const newFiles: Array<BatchFile> = paths.map((filePath) => ({ path: filePath }));

		setFiles([...files, ...newFiles]);
	}, [files, setFiles, context.main]);

	const handleRemove = useCallback(
		(index: number) => {
			setFiles(files.filter((_, position) => position !== index));
		},
		[files, setFiles],
	);

	return (
		<div
			className="flex h-full flex-col"
			onDragOver={handleDragOver}
			onDrop={handleDrop}
		>
			{files.length === 0 ? (
				<EmptyState onOpen={() => void handleAddFiles()} />
			) : (
				<ScrollArea className="flex-1">
					<div className="flex flex-col gap-1 p-2">
						{files.map((file, index) => (
							<FileRow
								key={`${file.path}-${index}`}
								file={file}
								name={basename(file.path)}
								jobState={file.jobId ? context.jobs.jobs.get(file.jobId) : undefined}
								running={running}
								onRemove={() => handleRemove(index)}
								onAbort={() => onAbortFile(index)}
							/>
						))}
					</div>
				</ScrollArea>
			)}
		</div>
	);
};
