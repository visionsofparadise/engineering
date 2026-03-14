import { resnapshot } from "../../models/ProxyStore/resnapshot";
import { useMemo } from "react";
import { Folder, X } from "lucide-react";
import type { AppContext } from "../../models/Context";
import { getProperties } from "../Session/Chain/Parameters/utils/schema";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

interface BinaryEntry {
	readonly key: string;
	readonly accept?: string;
}

function deriveBinaryEntries(context: AppContext): ReadonlyArray<BinaryEntry> {
	const entries = new Map<string, BinaryEntry>();

	for (const bundle of context.app.packages) {
		for (const mod of bundle.modules) {
			const properties = getProperties(mod.schema);
			if (!properties) continue;

			for (const prop of Object.values(properties)) {
				if (prop.binary && !entries.has(prop.binary)) {
					entries.set(prop.binary, { key: prop.binary, accept: prop.accept });
				}
			}
		}
	}

	for (const key of Object.keys(context.app.binaries)) {
		if (!entries.has(key)) {
			entries.set(key, { key });
		}
	}

	return Array.from(entries.values());
}

interface BinaryManagerProps {
	readonly context: AppContext;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}

export const BinaryManager: React.FC<BinaryManagerProps> = resnapshot(({ context, open, onOpenChange }) => {
	const binaries = context.app.binaries;
	const entries = useMemo(() => deriveBinaryEntries(context), [context.app.packages, context.app.binaries]);

	const handleBrowse = async (entry: BinaryEntry): Promise<void> => {
		const filters = entry.accept
			? [{ name: entry.key, extensions: entry.accept.split(",").map((ext) => ext.replace(".", "").trim()) }]
			: undefined;

		const paths = await context.main.showOpenDialog({
			title: `Select ${entry.key}`,
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
			Reflect.deleteProperty(proxy.binaries, key);
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Binary Manager</DialogTitle>
					<DialogDescription className="text-xs">
						Configure paths to external binaries and models required by installed packages.
					</DialogDescription>
				</DialogHeader>
				{entries.length === 0 ? (
					<p className="py-6 text-center text-sm text-muted-foreground">
						No binary dependencies detected. Install a package to see its required binaries here.
					</p>
				) : (
					<ScrollArea className="max-h-[60vh]" alwaysShowScrollbar>
						<div className="space-y-1 py-2 pr-3">
							<div className="mb-2 grid grid-cols-[10rem_1fr_auto] items-center gap-2">
								<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Binary Key</span>
								<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Path</span>
								<span className="w-[4.5rem]" />
							</div>
							{entries.map((entry) => {
								const currentPath = binaries[entry.key];

								return (
									<div key={entry.key} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2">
										<span className="truncate text-sm font-normal text-foreground/80">{entry.key}</span>
										<Input
											readOnly
											value={currentPath ?? ""}
											placeholder="Not set"
											className="h-8 min-w-0 text-xs"
										/>
										<div className="flex items-center">
											<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => void handleBrowse(entry)}>
												<Folder className="h-3.5 w-3.5" />
											</Button>
											{currentPath ? (
												<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => handleClear(entry.key)}>
													<X className="h-3.5 w-3.5" />
												</Button>
											) : (
												<div className="h-8 w-8" />
											)}
										</div>
									</div>
								);
							})}
						</div>
					</ScrollArea>
				)}
			</DialogContent>
		</Dialog>
	);
});
