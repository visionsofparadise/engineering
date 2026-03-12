import { Folder, X } from "lucide-react";
import type { AppContext } from "../../models/Context";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

interface BinaryEntry {
	readonly key: string;
	readonly label: string;
	readonly accept?: string;
	readonly category: string;
}

const BINARY_ENTRIES: ReadonlyArray<BinaryEntry> = [
	{ key: "ffmpeg", label: "FFmpeg", category: "Tools" },
	{ key: "ffprobe", label: "FFprobe", category: "Tools" },
	{ key: "dtln-model_1", label: "DTLN Model 1", accept: ".onnx", category: "Models" },
	{ key: "dtln-model_2", label: "DTLN Model 2", accept: ".onnx", category: "Models" },
	{ key: "Kim_Vocal_2", label: "Kim Vocal 2", accept: ".onnx", category: "Models" },
	{ key: "htdemucs", label: "HTDemucs", accept: ".onnx", category: "Models" },
];

interface BinaryManagerProps {
	readonly context: AppContext;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}

export const BinaryManager: React.FC<BinaryManagerProps> = ({ context, open, onOpenChange }) => {
	const binaries = context.app.binaries;

	const handleBrowse = async (entry: BinaryEntry): Promise<void> => {
		const filters = entry.accept
			? [{ name: entry.label, extensions: entry.accept.split(",").map((ext) => ext.replace(".", "").trim()) }]
			: undefined;

		const paths = await context.main.showOpenDialog({
			title: `Select ${entry.label}`,
			filters,
			properties: ["openFile"],
		});

		const selected = paths?.[0];
		if (!selected) return;

		context.appStore.mutate(context.app, (proxy) => {
			proxy.binaries[entry.key] = selected;
		});
	};

	const handleClear = (key: string): void => {
		context.appStore.mutate(context.app, (proxy) => {
			delete proxy.binaries[key];
		});
	};

	const categories = [...new Set(BINARY_ENTRIES.map((entry) => entry.category))];

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Binary Manager</DialogTitle>
				</DialogHeader>
				<ScrollArea className="max-h-[60vh]">
					<div className="grid gap-4 py-2">
						{categories.map((category) => (
							<div key={category}>
								<div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{category}</div>
								<div className="grid gap-2">
									{BINARY_ENTRIES.filter((entry) => entry.category === category).map((entry) => {
										const currentPath = binaries[entry.key];

										return (
											<div key={entry.key} className="flex items-center gap-2">
												<div className="w-28 shrink-0 text-sm">{entry.label}</div>
												<div className="min-w-0 flex-1 truncate rounded border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
													{currentPath || "Not set"}
												</div>
												<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void handleBrowse(entry)}>
													<Folder className="h-3.5 w-3.5" />
												</Button>
												{currentPath && (
													<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleClear(entry.key)}>
														<X className="h-3.5 w-3.5" />
													</Button>
												)}
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
};
