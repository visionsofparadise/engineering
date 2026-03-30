import { DropdownButton, IconButton, type MenuItem } from "@e9g/design-system";
import type { AppContext } from "../models/Context";

interface Props {
	readonly context: AppContext;
	readonly onOpenModuleManager: () => void;
	readonly onOpenBinaryManager: () => void;
}

const MENU_ITEMS: ReadonlyArray<MenuItem> = [
	{ kind: "action", icon: "lucide:file-plus", label: "New Session", shortcut: "Ctrl+N" },
	{ kind: "action", icon: "lucide:folder-open", label: "Open Session", shortcut: "Ctrl+O" },
	{ kind: "action", icon: "lucide:save", label: "Save", shortcut: "Ctrl+S" },
	{ kind: "action", icon: "lucide:save-all", label: "Save As\u2026", shortcut: "Ctrl+Shift+S" },
	{ kind: "separator" },
	{ kind: "action", icon: "lucide:undo-2", label: "Undo", shortcut: "Ctrl+Z" },
	{ kind: "action", icon: "lucide:redo-2", label: "Redo", shortcut: "Ctrl+Shift+Z" },
];

export const AppTabBar: React.FC<Props> = ({ context, onOpenModuleManager, onOpenBinaryManager }) => {
	const { app, appStore } = context;

	const tabs = app.tabs.map((tab) => ({
		id: tab.id,
		label: tab.bagPath.split("/").pop() ?? tab.bagPath,
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
	};

	return (
		<div className="flex h-9 shrink-0 items-center gap-2 bg-void px-2">
			<DropdownButton
				trigger={<IconButton icon="lucide:menu" label="Menu" size={16} />}
				items={MENU_ITEMS}
			/>

			<IconButton icon="lucide:blocks" label="Module Manager" size={16} onClick={onOpenModuleManager} />
			<IconButton icon="lucide:hard-drive" label="Binary Manager" size={16} onClick={onOpenBinaryManager} />

			<div className="h-4 w-px bg-chrome-border-subtle" />

			{tabs.map((tab) => {
				const isActive = tab.id === (app.activeTabId ?? "");

				return (
					<div
						key={tab.id}
						className={`flex items-center gap-2 ${
							isActive ? "bg-primary text-void" : "bg-chrome-raised text-chrome-text"
						}`}
						onClick={() => selectTab(tab.id)}
					>
						<span className="font-body text-[length:var(--text-sm)]">{tab.label}</span>
						<IconButton icon="lucide:x" label="Close tab" size={10} dim onClick={() => closeTab(tab.id)} />
					</div>
				);
			})}

			<IconButton
				icon="lucide:plus"
				label="New tab"
				active={!tabs.some((tab) => tab.id === (app.activeTabId ?? ""))}
				activeVariant="primary"
			/>
		</div>
	);
};
