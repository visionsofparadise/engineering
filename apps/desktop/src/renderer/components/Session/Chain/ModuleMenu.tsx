import { useState } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { AppState } from "../../../models/State/App";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

export interface ModuleSelection {
	readonly packageName: string;
	readonly moduleName: string;
}

export const ADD_MODULE_TRIGGER_CLASS = "flex w-full items-center justify-center gap-2 border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground";

interface ModuleMenuProps {
	readonly app: Snapshot<AppState>;
	readonly onSelect: (selection: ModuleSelection) => void;
	readonly onManagePackages?: () => void;
	readonly triggerClassName?: string;
	readonly triggerLabel?: string;
	readonly popoverAlign?: "start" | "center" | "end";
	readonly popoverSideOffset?: number;
}

interface FlatModule {
	readonly packageName: string;
	readonly moduleName: string;
	readonly moduleDescription: string;
}

const HIDDEN_MODULES = new Set(["Fan", "Chain", "Read", "Write", "Waveform", "Spectrogram"]);

function flattenModules(app: Snapshot<AppState>): ReadonlyArray<FlatModule> {
	return app.packages
		.flatMap((packageState) =>
			packageState.modules
				.filter((mod) => !HIDDEN_MODULES.has(mod.moduleName))
				.map((mod) => ({ packageName: packageState.directory, moduleName: mod.moduleName, moduleDescription: mod.moduleDescription })),
		)
		.sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

function fuzzyMatch(text: string, query: string): boolean {
	const lower = text.toLowerCase();
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	return terms.every((term) => lower.includes(term));
}

function filterModules(modules: ReadonlyArray<FlatModule>, search: string): ReadonlyArray<FlatModule> {
	if (!search) return modules;
	return modules.filter((mod) => fuzzyMatch(mod.moduleName, search) || fuzzyMatch(mod.moduleDescription, search));
}

export const ModuleMenu: React.FC<ModuleMenuProps> = ({ app, onSelect, onManagePackages, triggerClassName, triggerLabel, popoverAlign, popoverSideOffset }) => {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const modules = flattenModules(app);
	const filtered = filterModules(modules, search);

	const handleSelect = (mod: FlatModule) => {
		onSelect({ packageName: mod.packageName, moduleName: mod.moduleName });
		setOpen(false);
		setSearch("");
	};

	return (
		<Popover
			open={open}
			onOpenChange={setOpen}
		>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className={triggerClassName ?? "h-7 text-xs"}
				>
					{triggerLabel ?? "+ Add"}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="flex w-auto min-w-72 flex-col overflow-hidden p-0"
				style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
				side="left"
				align={popoverAlign ?? "start"}
				sideOffset={popoverSideOffset ?? 12}
				collisionPadding={12}
			>
				<div className="flex-shrink-0 p-2">
					<Input
						placeholder="Search modules..."
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="h-8 text-xs"
					/>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto" style={{ columns: "14rem" }}>
					{filtered.map((mod) => (
						<button
							key={`${mod.packageName}/${mod.moduleName}`}
							className="flex w-full flex-col gap-1 break-inside-avoid px-3 py-2 text-left hover:bg-accent"
							onClick={() => handleSelect(mod)}
						>
							<span className="text-xs font-medium">{mod.moduleName}</span>
							<span className="text-[10px] text-muted-foreground">{mod.moduleDescription}</span>
						</button>
					))}
					{filtered.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No modules found</p>}
				</div>
				{onManagePackages && (
					<div className="border-t border-border p-1">
						<button
							className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
							onClick={() => {
								setOpen(false);
								onManagePackages();
							}}
						>
							Manage Packages...
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
};
