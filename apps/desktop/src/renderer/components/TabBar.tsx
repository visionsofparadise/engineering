import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropdownButton, IconButton, type MenuItem } from "@e9g/design-system";
import type { AppContext } from "../models/Context";

interface Props {
	readonly context: AppContext;
	readonly onOpenModuleManager: () => void;
	readonly onOpenBinaryManager: () => void;
}

export function AppTabBar({ context, onOpenModuleManager, onOpenBinaryManager }: Props) {
	const { app, appStore } = context;

	const [editingTabId, setEditingTabId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const menuItems: ReadonlyArray<MenuItem> = useMemo(
		() => [
			{ kind: "action", icon: "lucide:file-plus", label: "New Session", shortcut: "Ctrl+N", onClick: () => void context.newBagTab() },
			{ kind: "action", icon: "lucide:folder-open", label: "Open Session", shortcut: "Ctrl+O", onClick: () => void context.openBagTab() },
			{ kind: "action", icon: "lucide:import", label: "Import Bag", shortcut: "Ctrl+Shift+O", onClick: () => void context.importBagIntoActiveTab() },
			{ kind: "action", icon: "lucide:save", label: "Save", shortcut: "Ctrl+S" },
			{ kind: "action", icon: "lucide:save-all", label: "Save As\u2026", shortcut: "Ctrl+Shift+S" },
			{ kind: "separator" },
			{ kind: "action", icon: "lucide:undo-2", label: "Undo", shortcut: "Ctrl+Z" },
			{ kind: "action", icon: "lucide:redo-2", label: "Redo", shortcut: "Ctrl+Shift+Z" },
		],
		[context],
	);

	const tabs = app.tabs.map((tab) => ({
		id: tab.id,
		label: context.tabNames.get(tab.id) ?? tab.bagPath.split(/[\\/]/).pop()?.replace(/\.bag$/i, "") ?? tab.bagPath,
	}));

	const selectTab = (id: string): void => {
		appStore.mutate(app, (proxy) => {
			proxy.activeTabId = id;
		});
	};

	const closeTab = (id: string): void => {
		appStore.mutate(app, (proxy) => {
			const index = proxy.tabs.findIndex((tab) => tab.id === id);

			if (index === -1) return;
			proxy.tabs.splice(index, 1);

			if (proxy.activeTabId === id) {
				proxy.activeTabId = proxy.tabs[index]?.id ?? proxy.tabs[index - 1]?.id ?? null;
			}
		});

		context.historyStacks.delete(id);
		context.tabNames.delete(id);
		context.renameCallbacks.delete(id);
		context.importCallbacks.delete(id);
	};

	const startEditing = useCallback((tabId: string, currentLabel: string) => {
		setEditingTabId(tabId);
		setEditingName(currentLabel);
	}, []);

	const commitRename = useCallback(() => {
		if (editingTabId && editingName.trim()) {
			context.renameTab(editingTabId, editingName.trim());
		}

		setEditingTabId(null);
		setEditingName("");
	}, [editingTabId, editingName, context]);

	const cancelEditing = useCallback(() => {
		setEditingTabId(null);
		setEditingName("");
	}, []);

	// Focus the input when editing starts
	useEffect(() => {
		if (editingTabId && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editingTabId]);

	return (
		<div className="flex h-9 shrink-0 items-center gap-2 bg-void px-2">
			<DropdownButton
				trigger={<IconButton icon="lucide:menu" label="Menu" size={16} />}
				items={menuItems}
			/>

			<IconButton icon="lucide:blocks" label="Module Manager" size={16} onClick={onOpenModuleManager} />
			<IconButton icon="lucide:hard-drive" label="Binary Manager" size={16} onClick={onOpenBinaryManager} />

			<div className="h-4 w-px bg-chrome-border-subtle" />

			{tabs.map((tab) => {
				const isActive = tab.id === (app.activeTabId ?? "");
				const isEditing = editingTabId === tab.id;

				return (
					<div
						key={tab.id}
						className={`flex items-center gap-2 ${
							isActive ? "bg-primary text-void" : "bg-chrome-raised text-chrome-text"
						}`}
						onClick={() => selectTab(tab.id)}
					>
						{isEditing ? (
							<input
								ref={inputRef}
								type="text"
								value={editingName}
								onChange={(event) => setEditingName(event.target.value)}
								onBlur={commitRename}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										commitRename();
									} else if (event.key === "Escape") {
										cancelEditing();
									}

									event.stopPropagation();
								}}
								onClick={(event) => event.stopPropagation()}
								className="w-32 bg-transparent font-body text-[length:var(--text-sm)] text-inherit outline-none"
							/>
						) : (
							<span
								className="font-body text-[length:var(--text-sm)]"
								onDoubleClick={(event) => {
									event.stopPropagation();
									startEditing(tab.id, tab.label);
								}}
							>
								{tab.label}
							</span>
						)}
						<IconButton icon="lucide:x" label="Close tab" size={10} dim onClick={() => closeTab(tab.id)} />
					</div>
				);
			})}

			<IconButton
				icon="lucide:plus"
				label="New tab"
				active={!tabs.some((tab) => tab.id === (app.activeTabId ?? ""))}
				activeVariant="primary"
				onClick={() => void context.newBagTab()}
			/>
		</div>
	);
}
