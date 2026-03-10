import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { AppContext } from "../models/Context";
import { cn } from "../utils/cn";
import { removeTab, reorderTabs, setActiveTab } from "../utils/tabs";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";

const BATCH_TAB_ID = "batch";

interface TabsProps {
	context: AppContext;
}

export const Tabs: React.FC<TabsProps> = ({ context }) => {
	const { app, appStore, main } = context;
	const sessionTabs = app.tabs;

	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [dropTarget, setDropTarget] = useState<number | null>(null);
	const dragIndexRef = useRef<number | null>(null);

	const handleDragStart = useCallback((index: number) => {
		setDragIndex(index);
		dragIndexRef.current = index;
	}, []);

	const handleDragOver = useCallback((ev: React.DragEvent, index: number) => {
		ev.preventDefault();
		setDropTarget(index);
	}, []);

	const handleDrop = useCallback(
		(toIndex: number) => {
			const fromIndex = dragIndexRef.current;

			if (fromIndex !== null && fromIndex !== toIndex) {
				reorderTabs(fromIndex, toIndex, { appStore, app });
			}

			setDragIndex(null);
			setDropTarget(null);
			dragIndexRef.current = null;
		},
		[appStore, app],
	);

	const handleDragEnd = useCallback(() => {
		setDragIndex(null);
		setDropTarget(null);
		dragIndexRef.current = null;
	}, []);

	return (
		<div className="flex h-9 border-b border-border">
			<ScrollArea className="flex-1">
				<div className="flex h-9 items-end">
					{sessionTabs.map((tab, index) => (
						<div
							key={tab.id}
							draggable
							onDragStart={() => handleDragStart(index)}
							onDragOver={(ev) => handleDragOver(ev, index)}
							onDrop={() => handleDrop(index)}
							onDragEnd={handleDragEnd}
							onClick={() => setActiveTab(tab.id, { appStore, app })}
							className={cn(
								"group flex h-8 cursor-pointer items-center gap-1 border-r border-border px-3 text-xs transition-colors",
								app.activeTabId === tab.id ? "bg-background text-foreground" : "bg-muted/50 text-muted-foreground hover:text-foreground",
								dragIndex === index && "opacity-50",
								dropTarget === index && "border-l-2 border-l-ring",
							)}
						>
							<span className="max-w-[120px] truncate">{tab.label}</span>
							<button
								onClick={(ev) => {
									ev.stopPropagation();
									removeTab(tab.id, { appStore, app, main });
								}}
								className="ml-1 hidden rounded-sm p-0.5 hover:bg-accent group-hover:block"
							>
								<X className="h-3 w-3" />
							</button>
						</div>
					))}
				</div>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>

			<div
				onClick={() => setActiveTab(BATCH_TAB_ID, { appStore, app })}
				className={cn(
					"flex h-8 cursor-pointer items-center self-end border-l border-border px-3 text-xs transition-colors",
					app.activeTabId === BATCH_TAB_ID ? "bg-background text-foreground" : "bg-muted/50 text-muted-foreground hover:text-foreground",
				)}
			>
				<span>Batch</span>
			</div>
		</div>
	);
};
