import type { ChainDefinition } from "@engineering/acm";
import { validateChainDefinition } from "@engineering/acm";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../../../ui/dropdown-menu";
import { Input } from "../../../ui/input";
import { deleteChain, loadChain, saveChain } from "./chains";
import { useChains } from "./useChains";

interface ChainManagerMenuProps {
	readonly chain: ChainDefinition;
	readonly onChainChange: (chain: ChainDefinition) => void;
	readonly userDataPath: string;
}

export const ChainManagerMenu: React.FC<ChainManagerMenuProps> = ({ chain, onChainChange, userDataPath }) => {
	const queryClient = useQueryClient();
	const { data: savedChains } = useChains(userDataPath);
	const [loadedLabel, setLoadedLabel] = useState("");
	const [saveLabel, setSaveLabel] = useState("");

	const invalidateChains = () => {
		void queryClient.invalidateQueries({ queryKey: ["chains"] });
	};

	const handleLoad = async (filename: string) => {
		const loaded = await loadChain(userDataPath, filename);
		onChainChange(loaded);
		setLoadedLabel(loaded.label ?? "");
		setSaveLabel(loaded.label ?? "");
	};

	const handleSave = async () => {
		const label = saveLabel.trim();

		if (!label) return;

		await saveChain(userDataPath, { ...chain, label });

		setLoadedLabel(label);
		invalidateChains();
	};

	const handleDelete = async (filename: string, label: string) => {
		await deleteChain(userDataPath, filename);

		if (label === loadedLabel) {
			setLoadedLabel("");
			setSaveLabel("");
		}

		invalidateChains();
	};

	const handleImport = async () => {
		const paths = await window.main.showOpenDialog({
			title: "Import Chain",
			filters: [{ name: "Chain Definition", extensions: ["json"] }],
			properties: ["openFile"],
		});

		const selectedPath = paths?.[0];

		if (!selectedPath) return;

		try {
			const content = await window.main.readFile(selectedPath);
			const imported = validateChainDefinition(JSON.parse(content));

			if (!imported.label) {
				const filename = selectedPath.split(/[/\\]/).pop()?.replace(".json", "") ?? "imported";

				imported.label = filename;
			}

			await saveChain(userDataPath, imported);

			invalidateChains();
		} catch {
			toast.error("Invalid chain file");
		}
	};

	const handleExport = async () => {
		const defaultName = (chain.label ?? "chain").toLowerCase().replace(/[^a-z0-9-]/g, "-");

		const filePath = await window.main.showSaveDialog({
			title: "Export Chain",
			defaultPath: `${defaultName}.json`,
			filters: [{ name: "Chain Definition", extensions: ["json"] }],
		});

		if (!filePath) return;

		await window.main.writeFile(filePath, JSON.stringify(chain, undefined, 2));
	};

	const handleClear = () => {
		onChainChange({ ...chain, transforms: [] });
		setLoadedLabel("");
		setSaveLabel("");
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-7 p-0 text-xs"
				>
					&#8942;
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-56"
			>
				<DropdownMenuLabel className="text-xs">Saved Chains</DropdownMenuLabel>
				{savedChains && savedChains.length > 0 ? (
					savedChains.map((entry) => (
						<DropdownMenuItem
							key={entry.filename}
							className="text-xs"
							onSelect={() => void handleLoad(entry.filename)}
						>
							{entry.label}
						</DropdownMenuItem>
					))
				) : (
					<div className="px-2 py-1.5 text-xs text-muted-foreground">No saved chains</div>
				)}

				<DropdownMenuSeparator />

				<DropdownMenuItem
					asChild
					onSelect={(event) => event.preventDefault()}
				>
					<div className="flex gap-1">
						<Input
							placeholder="Chain name..."
							value={saveLabel}
							onChange={(event) => setSaveLabel(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void handleSave();
							}}
							className="h-7 flex-1 text-xs"
						/>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							disabled={!saveLabel.trim()}
							onClick={() => void handleSave()}
						>
							Save
						</Button>
					</div>
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				{savedChains && savedChains.length > 0 && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="text-xs">Delete</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{savedChains.map((entry) => (
								<DropdownMenuItem
									key={entry.filename}
									className="text-xs"
									onSelect={() => void handleDelete(entry.filename, entry.label)}
								>
									{entry.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}

				<DropdownMenuItem
					className="text-xs"
					onSelect={() => void handleImport()}
				>
					Import...
				</DropdownMenuItem>
				<DropdownMenuItem
					className="text-xs"
					onSelect={() => void handleExport()}
				>
					Export...
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuItem
					className="text-xs"
					disabled={chain.transforms.length === 0}
					onSelect={handleClear}
				>
					Clear Chain
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
