import { useEffect, useRef } from "react";

export type ContextMenuAction = "add" | "delete" | "bypass" | "render";

interface ContextMenuActionItem {
	readonly kind: "action";
	readonly label: string;
	readonly action: ContextMenuAction;
}

interface ContextMenuSeparator {
	readonly kind: "separator";
}

export type ContextMenuItem = ContextMenuActionItem | ContextMenuSeparator;

export interface ContextMenuPosition {
	readonly x: number;
	readonly y: number;
	readonly nodeId?: string;
}

export const PANE_MENU_ITEMS: ReadonlyArray<ContextMenuItem> = [{ kind: "action", label: "Add Node", action: "add" }];

export const NODE_MENU_ITEMS: ReadonlyArray<ContextMenuItem> = [
	{ kind: "action", label: "Add Node", action: "add" },
	{ kind: "action", label: "Delete Node", action: "delete" },
	{ kind: "separator" },
	{ kind: "action", label: "Bypass / Enable", action: "bypass" },
	{ kind: "separator" },
	{ kind: "action", label: "Render", action: "render" },
];

interface Props {
	readonly position: ContextMenuPosition;
	readonly items: ReadonlyArray<ContextMenuItem>;
	readonly onAction: (action: ContextMenuAction) => void;
	readonly onClose: () => void;
}

export function GraphContextMenu({ position, items, onAction, onClose }: Props) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		const handleClickOutside = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as globalThis.Node)) {
				onClose();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		document.addEventListener("mousedown", handleClickOutside);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			className="fixed z-[100] min-w-44 bg-chrome-raised py-2 font-technical"
			style={{ top: position.y, left: position.x }}
		>
			{items.map((item, index) => {
				if (item.kind === "separator") {
					return (
						<div
							key={`sep-${index}`}
							className="my-1 mx-3 h-px bg-chrome-border-subtle"
						/>
					);
				}

				return (
					<button
						key={item.action}
						type="button"
						onClick={() => onAction(item.action)}
						className="mx-2 my-0.5 block w-[calc(100%-1rem)] text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text hover:bg-interactive-hover"
					>
						{item.label}
					</button>
				);
			})}
		</div>
	);
}
