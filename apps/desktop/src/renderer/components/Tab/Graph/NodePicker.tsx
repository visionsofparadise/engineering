import { useEffect, useRef } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { AppState } from "../../../models/State/App";

interface NodePickerProps {
	readonly app: Snapshot<AppState>;
	readonly onSelect: (packageName: string, nodeName: string) => void;
	readonly onClose: () => void;
	readonly position: { readonly x: number; readonly y: number };
}

export function NodePicker({ app, onSelect, onClose, position }: NodePickerProps) {
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

	const readyPackages = app.packages.filter((modulePackage) => modulePackage.status === "ready");

	return (
		<div
			ref={menuRef}
			className="fixed z-[100] min-w-56 bg-chrome-raised py-2 font-technical"
			style={{ top: position.y, left: position.x }}
		>
			{readyPackages.length === 0 && <div className="mx-2 px-1 py-1 text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-muted">No packages loaded</div>}
			{readyPackages.map((modulePackage) => (
				<div key={modulePackage.name}>
					<div className="mx-2 px-1 py-1 text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-muted">{modulePackage.name}</div>
					{modulePackage.modules.map((mod) => (
						<button
							key={mod.moduleName}
							type="button"
							onClick={() => {
								onSelect(modulePackage.name, mod.moduleName);
								onClose();
							}}
							className="mx-2 my-0.5 block w-[calc(100%-1rem)] text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text hover:bg-interactive-hover"
							title={mod.moduleDescription}
						>
							{mod.moduleName}
						</button>
					))}
				</div>
			))}
		</div>
	);
}
