import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd";
import { X } from "lucide-react";
import { useCallback } from "react";
import type { AppContext } from "../models/Context";
import type { TabEntry } from "../models/State/App";
import { cn } from "../utils/cn";
import { removeTab, reorderTabs, setActiveTab } from "../utils/tabs";
import { ScrollArea, ScrollBar } from "./ui/scroll-area";

const GUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;

function getTabDisplayName(tab: TabEntry): string {
	if (GUID_PREFIX.test(tab.id)) {
		return tab.id.replace(GUID_PREFIX, "");
	}

	return tab.label || tab.id;
}

interface TabsProps {
	context: AppContext;
}

export const Tabs: React.FC<TabsProps> = ({ context }) => {
	const { app, appStore } = context;

	const sessionTabs = app.tabs;

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			if (!result.destination || result.source.index === result.destination.index) return;

			reorderTabs(result.source.index, result.destination.index, { appStore, app });
		},
		[appStore, app],
	);

	const handleTabClick = useCallback(
		(tabId: string) => {
			setActiveTab(tabId, { appStore, app });
		},
		[appStore, app],
	);

	return (
		<div className="flex h-9 shrink-0 border-b border-border bg-[var(--surface-panel-header)]">
			<ScrollArea className="flex-1">
				<DragDropContext onDragEnd={handleDragEnd}>
					<Droppable droppableId="tabs" direction="horizontal">
						{(provided) => (
							<div
								ref={provided.innerRef}
								{...provided.droppableProps}
								className="flex h-9 items-stretch"
							>
								{sessionTabs.map((tab, index) => (
									<Draggable key={tab.id} draggableId={tab.id} index={index}>
										{(provided, snapshot) => (
											<div
												ref={provided.innerRef}
												{...provided.draggableProps}
												{...provided.dragHandleProps}
												onClick={() => handleTabClick(tab.id)}
												className={cn(
													"group flex cursor-pointer items-center gap-1 border-r border-border px-5 text-xs transition-colors",
													app.activeTabId === tab.id ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
													snapshot.isDragging && "opacity-50",
												)}
											>
												<span className="max-w-[120px] truncate">{getTabDisplayName(tab)}</span>
												<button
													onClick={(ev) => {
														ev.stopPropagation();
														removeTab(tab.id, { appStore, app });
													}}
													className="ml-1 hidden rounded-sm p-0.5 hover:bg-accent group-hover:block"
												>
													<X className="h-3 w-3" />
												</button>
											</div>
										)}
									</Draggable>
								))}
								{provided.placeholder}
							</div>
						)}
					</Droppable>
				</DragDropContext>
				<ScrollBar orientation="horizontal" />
			</ScrollArea>
		</div>
	);
};
