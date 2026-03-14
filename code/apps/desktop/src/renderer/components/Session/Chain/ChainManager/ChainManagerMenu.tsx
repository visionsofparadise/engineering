import { useQueryClient } from "@tanstack/react-query";
import type { IdentifiedChain } from "../../../../hooks/useChain";
import { useState } from "react";
import { Download, Save, Trash2, Upload, X } from "lucide-react";
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
	readonly chain: IdentifiedChain;
	readonly onChainChange: (chain: IdentifiedChain) => void;
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
		onChainChange({
			...loaded,
			transforms: loaded.transforms.map((transform) => ({ ...transform, id: crypto.randomUUID() })),
		});
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
			const imported = await window.main.validateChain(JSON.parse(content));

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
				<DropdownMenuItem
					asChild
					onSelect={(event) => event.preventDefault()}
				>
					<div className="flex gap-2">
						<Input
							placeholder="Chain name..."
							value={saveLabel}
							onChange={(event) => setSaveLabel(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void handleSave();
							}}
							className="h-8 flex-1 text-sm"
						/>
						<Button
							size="sm"
							className="h-8 surface-control"
							disabled={!saveLabel.trim()}
							onClick={() => void handleSave()}
						>
							Save
						</Button>
					</div>
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuLabel className="flex items-center gap-3">
					<Save className="h-4 w-4" />
					Saved Chains
				</DropdownMenuLabel>
				{savedChains && savedChains.length > 0 ? (
					savedChains.map((entry) => (
						<DropdownMenuItem
							key={entry.filename}
							onSelect={() => void handleLoad(entry.filename)}
						>
							{entry.label}
						</DropdownMenuItem>
					))
				) : (
					<div className="px-3 py-1.5 text-sm text-muted-foreground">No saved chains</div>
				)}

				<DropdownMenuSeparator />

				{savedChains && savedChains.length > 0 && (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Trash2 className="h-4 w-4" />
							Delete
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{savedChains.map((entry) => (
								<DropdownMenuItem
									key={entry.filename}
									onSelect={() => void handleDelete(entry.filename, entry.label)}
								>
									{entry.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				)}

				<DropdownMenuItem
					onSelect={() => void handleImport()}
				>
					<Upload className="h-4 w-4" />
					Import
				</DropdownMenuItem>
				<DropdownMenuItem
					onSelect={() => void handleExport()}
				>
					<Download className="h-4 w-4" />
					Export
				</DropdownMenuItem>

				<DropdownMenuSeparator />

				<DropdownMenuItem
					disabled={chain.transforms.length === 0}
					onSelect={handleClear}
				>
					<X className="h-4 w-4" />
					Clear
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
