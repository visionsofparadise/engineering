import { useState } from "react";
import { MODULE_REGISTRY, type ModuleClass } from "../../../../shared/ipc/Audio/apply/utils/registry";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { ScrollArea } from "../../ui/scroll-area";

interface ModuleMenuProps {
	readonly onSelect: (moduleName: string) => void;
}

const modules: ReadonlyArray<ModuleClass> = [...MODULE_REGISTRY.values()].sort((left, right) => left.moduleName.localeCompare(right.moduleName));

export const ModuleMenu: React.FC<ModuleMenuProps> = ({ onSelect }) => {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");

	const filtered = search ? modules.filter((mod) => mod.moduleName.toLowerCase().includes(search.toLowerCase())) : modules;

	const handleSelect = (name: string) => {
		onSelect(name);
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
								key={mod.moduleName}
								className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent"
								onClick={() => handleSelect(mod.moduleName)}
							>
								<span className="text-xs font-medium">{mod.moduleName}</span>
								<span className="text-[10px] text-muted-foreground">{mod.moduleDescription}</span>
							</button>
						))}
						{filtered.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">No modules found</p>}
					</div>
				</ScrollArea>
			</PopoverContent>
		</Popover>
	);
};
