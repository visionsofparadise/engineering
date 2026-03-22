import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { validateGraphDefinition, type GraphDefinition } from "buffered-audio-nodes";
import type { SessionContext } from "../../../../models/Context";
import { Button } from "../../../ui/button";
import { Input } from "../../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";

interface GraphManagerProps {
	readonly context: SessionContext;
}

interface SavedGraph {
	readonly fileName: string;
	readonly name: string;
	readonly path: string;
}

function sanitizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export const GraphManager: React.FC<GraphManagerProps> = ({ context }) => {
	const [open, setOpen] = useState(false);
	const [saveName, setSaveName] = useState("");
	const queryClient = useQueryClient();

	const graphsDir = `${context.userDataPath}/graphs`;

	const { data: savedGraphs = [] } = useQuery({
		queryKey: ["graphs"],
		queryFn: async (): Promise<ReadonlyArray<SavedGraph>> => {
			await window.main.ensureDirectory(graphsDir);
			const entries = await window.main.readDirectory(graphsDir);
			const bagFiles = entries.filter((entry) => entry.endsWith(".bag"));

			const graphs = await Promise.all(
				bagFiles.map(async (fileName) => {
					const path = `${graphsDir}/${fileName}`;
					try {
						const content = await window.main.readFile(path);
						const definition = validateGraphDefinition(JSON.parse(content));
						return { fileName, name: definition.name, path };
					} catch {
						return { fileName, name: fileName.replace(/\.bag$/, ""), path };
					}
				}),
			);

			return graphs;
		},
		enabled: open,
	});

	const loadGraph = async (definition: GraphDefinition) => {
		await window.main.writeFile(context.bagPath, JSON.stringify(definition, null, 2));
		await queryClient.invalidateQueries({ queryKey: ["graph", context.bagPath] });
	};

	const handleSave = async () => {
		const trimmed = saveName.trim();
		if (!trimmed) return;

		const { graphDefinition } = context.graph;
		if (!graphDefinition) return;

		const sanitized = sanitizeName(trimmed);
		if (!sanitized) return;

		const toSave: GraphDefinition = { ...graphDefinition, name: trimmed };

		await window.main.ensureDirectory(graphsDir);
		await window.main.writeFile(`${graphsDir}/${sanitized}.bag`, JSON.stringify(toSave, null, 2));
		await queryClient.invalidateQueries({ queryKey: ["graphs"] });
		setSaveName("");
	};

	const handleDelete = async (graph: SavedGraph) => {
		await window.main.deleteFile(graph.path);
		await queryClient.invalidateQueries({ queryKey: ["graphs"] });
	};

	const handleLoad = async (graph: SavedGraph) => {
		try {
			const content = await window.main.readFile(graph.path);
			const definition = validateGraphDefinition(JSON.parse(content));
			await loadGraph(definition);
			setOpen(false);
		} catch {
			/* invalid file — ignore */
		}
	};

	const handleImport = async () => {
		const paths = await window.main.showOpenDialog({
			title: "Import Graph",
			filters: [{ name: "BAG Files", extensions: ["bag"] }],
			properties: ["openFile"],
		});

		const importPath = paths?.[0];
		if (!importPath) return;

		try {
			const content = await window.main.readFile(importPath);
			const definition = validateGraphDefinition(JSON.parse(content));
			await loadGraph(definition);
			setOpen(false);
		} catch {
			/* invalid file — ignore */
		}
	};

	const handleExport = async () => {
		const { graphDefinition } = context.graph;
		if (!graphDefinition) return;

		const defaultName = sanitizeName(graphDefinition.name || "untitled");
		const savePath = await window.main.showSaveDialog({
			title: "Export Graph",
			defaultPath: `${defaultName}.bag`,
			filters: [{ name: "BAG Files", extensions: ["bag"] }],
		});

		if (!savePath) return;

		await window.main.writeFile(savePath, JSON.stringify(graphDefinition, null, 2));
	};

	const handleClear = async () => {
		const cleared: GraphDefinition = { name: "Untitled", nodes: [], edges: [] };
		await loadGraph(cleared);
		setOpen(false);
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" className="h-7 text-xs">
					Graphs
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="flex w-72 flex-col overflow-hidden p-0"
				style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
				side="bottom"
				align="end"
				sideOffset={4}
				collisionPadding={12}
			>
				<div className="flex-shrink-0 border-b border-border p-2">
					<div className="flex gap-1">
						<Input
							placeholder="Save as..."
							value={saveName}
							onChange={(event) => setSaveName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void handleSave();
							}}
							className="h-7 flex-1 text-xs"
						/>
						<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void handleSave()}>
							Save
						</Button>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{savedGraphs.length === 0 && (
						<p className="px-2 py-4 text-center text-xs text-muted-foreground">No saved graphs</p>
					)}
					{savedGraphs.map((graph) => (
						<div
							key={graph.fileName}
							className="flex items-center justify-between px-3 py-1.5 hover:bg-accent"
						>
							<button
								className="flex-1 text-left text-xs"
								onClick={() => void handleLoad(graph)}
							>
								{graph.name}
							</button>
							<button
								className="ml-2 text-xs text-muted-foreground hover:text-destructive"
								onClick={() => void handleDelete(graph)}
							>
								&times;
							</button>
						</div>
					))}
				</div>

				<div className="flex flex-shrink-0 border-t border-border p-1">
					<button
						className="flex-1 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
						onClick={() => void handleImport()}
					>
						Import
					</button>
					<button
						className="flex-1 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"
						onClick={() => void handleExport()}
					>
						Export
					</button>
					<button
						className="flex-1 px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-destructive"
						onClick={() => void handleClear()}
					>
						Clear
					</button>
				</div>
			</PopoverContent>
		</Popover>
	);
};
