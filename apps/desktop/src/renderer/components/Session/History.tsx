import { resnapshot } from "../../models/ProxyStore/resnapshot";
import { Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import type { SessionContext } from "../../models/Context";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { useSnapshots } from "./hooks/useSnapshots";

interface HistoryProps {
	readonly context: SessionContext;
}

function parseSnapshotLabel(folderName: string): string {
	const parts = folderName.split("-");
	if (parts.length >= 3) {
		const moduleName = parts.slice(2).join("-");
		return `After ${moduleName}`;
	}
	return "Source";
}

function parseSnapshotTimestamp(folderName: string): string {
	// Folder format: "2026-03-13T18-24-12-799Z-source" or "1710345678901-0-ModuleName"
	const isoMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(folderName);
	if (isoMatch) {
		return `${isoMatch[2]}:${isoMatch[3]}:${isoMatch[4]}`;
	}

	// Unix timestamp prefix
	const unixMatch = /^(\d{13})/.exec(folderName);
	if (unixMatch) {
		const date = new Date(Number(unixMatch[1]));
		return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
	}

	return "";
}

export const History: React.FC<HistoryProps> = resnapshot(({ context }) => {
	const snapshots = useSnapshots(context);
	const tab = context.app.tabs.find((entry) => entry.workingDir === context.sessionPath);
	const activeFolder = tab?.activeSnapshotFolder;
	const currentFolder = activeFolder ?? snapshots[snapshots.length - 1];
	const [hoveredFolder, setHoveredFolder] = useState<string | null>(null);

	const handleClick = useCallback(
		(folder: string) => {
			const isLatest = folder === snapshots[snapshots.length - 1];
			context.appStore.mutate(context.app, (proxy) => {
				const proxyTab = proxy.tabs.find((entry) => entry.workingDir === context.sessionPath);
				if (proxyTab) {
					proxyTab.activeSnapshotFolder = isLatest ? undefined : folder;
				}
			});
		},
		[context, snapshots],
	);

	const handleDelete = useCallback(
		async (folder: string) => {
			const snapshotPath = `${context.sessionPath}/${folder}`;
			await context.main.deleteFile(snapshotPath);

			// If we deleted the active snapshot, reset to latest
			if (folder === currentFolder) {
				context.appStore.mutate(context.app, (proxy) => {
					const proxyTab = proxy.tabs.find((entry) => entry.workingDir === context.sessionPath);
					if (proxyTab) {
						proxyTab.activeSnapshotFolder = undefined;
					}
				});
			}

			void context.queryClient.invalidateQueries({ queryKey: ["snapshots", context.sessionPath] });
		},
		[context, currentFolder],
	);

	return (
		<div className="flex h-full flex-col p-3">
			<div className="flex items-center pb-2">
				<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">History</span>
			</div>
			<ScrollArea className="flex-1">
				{snapshots.length === 0 ? (
					<div className="flex items-center justify-center p-4">
						<p className="text-xs text-muted-foreground">No history</p>
					</div>
				) : (
					<div className="flex flex-col gap-0.5">
						{snapshots.map((folder, index) => {
								const isSource = index === 0;
								const label = isSource ? "Source" : parseSnapshotLabel(folder);
								const timestamp = parseSnapshotTimestamp(folder);
								const isActive = folder === currentFolder;
								const isHovered = hoveredFolder === folder;

								return (
									<button
										key={folder}
										className={`group flex items-center gap-2 rounded px-3 py-2 text-left text-xs ${
											isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
										}`}
										onClick={() => handleClick(folder)}
										onMouseEnter={() => setHoveredFolder(folder)}
										onMouseLeave={() => setHoveredFolder(null)}
									>
										<span className="flex-1 truncate">{label}</span>
										{timestamp && (
											<span className="shrink-0 font-mono text-[0.625rem] tabular-nums text-muted-foreground">
												{timestamp}
											</span>
										)}
										{!isSource && isHovered && (
											<Button
												variant="ghost"
												size="icon"
												className="h-5 w-5 shrink-0"
												onClick={(event) => {
													event.stopPropagation();
													void handleDelete(folder);
												}}
											>
												<Trash2 className="h-3 w-3" />
											</Button>
										)}
									</button>
								);
							})}
						</div>
					)}
			</ScrollArea>
		</div>
	);
});
