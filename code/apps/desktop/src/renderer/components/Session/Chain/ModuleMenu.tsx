import { useState } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { AppState } from "../../../models/State/App";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { ScrollArea } from "../../ui/scroll-area";

export interface ModuleSelection {
	readonly packageName: string;
	readonly moduleName: string;
}

interface ModuleMenuProps {
	readonly app: Snapshot<AppState>;
	readonly onSelect: (selection: ModuleSelection) => void;
	readonly onManagePackages?: () => void;
}

interface FlatModule {
	readonly packageName: string;
	readonly moduleName: string;
	readonly moduleDescription: string;
}

const ANALYSIS_MODULES = new Set(["Waveform", "Spectrogram"]);

function flattenModules(app: Snapshot<AppState>): ReadonlyArray<FlatModule> {
	return app.packages
		.flatMap((packageState) =>
			packageState.modules
				.filter((mod) => !ANALYSIS_MODULES.has(mod.moduleName))
				.map((mod) => ({ packageName: packageState.directory, moduleName: mod.moduleName, moduleDescription: mod.moduleDescription })),
		)
		.sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

export const ModuleMenu: React.FC<ModuleMenuProps> = ({ app, onSelect, onManagePackages }) => {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const modules = flattenModules(app);
	const filtered = search ? modules.filter((mod) => mod.moduleName.toLowerCase().includes(search.toLowerCase())) : modules;

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
					className="h-7 text-xs"
				>
					+ Add
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-64 p-0"
				align="end"
			>
				<div className="p-2">
					<Input
						placeholder="Search modules..."
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						className="h-7 text-xs"
					/>
				</div>
				<ScrollArea className="max-h-64">
					<div className="px-1 pb-1">
						{filtered.map((mod) => (
							<button
								key={`${mod.packageName}/${mod.moduleName}`}
								className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent"
								onClick={() => handleSelect(mod)}
							>
								<span className="text-xs font-medium">{mod.moduleName}</span>
								<span className="text-[10px] text-muted-foreground">{mod.moduleDescription}</span>
							</button>
						))}
						{filtered.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No modules found</p>}
					</div>
				</ScrollArea>
				{onManagePackages && (
					<div className="border-t border-border p-1">
						<button
							className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
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
