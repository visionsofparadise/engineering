import { useCallback } from "react";
import type { SessionContext } from "../../models/Context";
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
	return "Original";
}

export const History: React.FC<HistoryProps> = ({ context }) => {
	const snapshots = useSnapshots(context);
	const tab = context.app.tabs.find((entry) => entry.workingDir === context.sessionPath);
	const activeFolder = tab?.activeSnapshotFolder;
	const currentFolder = activeFolder ?? snapshots[snapshots.length - 1];

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

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground">History</span>
			</div>
			<ScrollArea className="flex-1">
				{snapshots.length === 0 ? (
					<div className="flex items-center justify-center p-4">
						<p className="text-xs text-muted-foreground">No history</p>
					</div>
				) : (
					<div className="flex flex-col gap-0.5 p-1">
						{snapshots.map((folder, index) => (
							<button
								key={folder}
								className={`rounded px-2 py-1 text-left text-xs ${
									folder === currentFolder ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
								}`}
								onClick={() => handleClick(folder)}
							>
								{index === 0 ? "Original" : parseSnapshotLabel(folder)}
							</button>
						))}
					</div>
				)}
			</ScrollArea>
		</div>
	);
};
