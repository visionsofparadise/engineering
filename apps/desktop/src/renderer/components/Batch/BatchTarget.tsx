import { FolderOpen } from "lucide-react";
import { useCallback } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { AppContext } from "../../models/Context";
import type { ProxyStore } from "../../models/ProxyStore/ProxyStore";
import type { AppState, BatchTarget as BatchTargetType } from "../../models/State/App";
import { ButtonBank } from "../ui/button-bank";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Slider } from "../ui/slider";

interface BatchTargetProps {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly disabled: boolean;
	readonly context: AppContext;
}

const MAX_CONCURRENCY = navigator.hardwareConcurrency || 16;

export const BatchTarget: React.FC<BatchTargetProps> = ({ app, appStore, disabled, context }) => {
	const target = app.batch.target;

	const update = useCallback(
		(partial: Partial<BatchTargetType>) => {
			appStore.mutate(app, (proxy) => {
				Object.assign(proxy.batch.target, partial);
			});
		},
		[app, appStore],
	);

	const handleBrowse = useCallback(async () => {
		const paths = await context.main.showOpenDialog({
			title: "Select Output Directory",
			properties: ["openDirectory"],
		});
		const selected = paths?.[0];
		if (selected) update({ outputDir: selected });
	}, [context.main, update]);

	const updateConcurrency = useCallback(
		(value: number) => {
			appStore.mutate(app, (proxy) => {
				proxy.batch.concurrency = Math.max(1, value);
			});
		},
		[app, appStore],
	);

	const dirName = target.outputDir
		? target.outputDir.split(/[\\/]/).pop() ?? target.outputDir
		: undefined;

	return (
		<div className="flex h-full flex-col">
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-7">
					<div className="grid items-start gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
						<div className="grid gap-2">
							<Label>Output Directory</Label>
							<div className="flex items-center gap-1">
								<div
									className="surface-control flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3"
									onClick={() => void handleBrowse()}
								>
									<span className={dirName ? "flex-1 truncate text-sm text-foreground" : "flex-1 truncate text-sm text-muted-foreground"}>
										{dirName ?? "Select output directory..."}
									</span>
								</div>
								<button
									type="button"
									className="surface-control flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground transition-all hover:text-foreground active:translate-y-px"
									disabled={disabled}
									onClick={() => void handleBrowse()}
								>
									<FolderOpen className="h-4 w-4" />
								</button>
							</div>
							{target.outputDir && (
								<p className="truncate text-[10px] text-muted-foreground">{target.outputDir}</p>
							)}
						</div>

						<div className="grid gap-2">
							<Label>Filename Template</Label>
							<Input
								value={target.template}
								onChange={(event) => update({ template: event.target.value })}
								placeholder="{name}"
								disabled={disabled}
							/>
							<p className="text-[10px] text-muted-foreground">
								Variables: {"{name}"}, {"{ext}"}, {"{index}"}, {"{index:N}"}
							</p>
						</div>
					</div>

					<div className="grid items-start gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))" }}>
						<div className="grid gap-2">
							<Label>Format</Label>
							<ButtonBank
								value={target.format}
								onValueChange={(value) => update({ format: value as BatchTargetType["format"] })}
								options={["wav", "flac", "mp3", "aac"]}
								disabled={disabled}
							/>
						</div>

						{(target.format === "wav" || target.format === "flac") && (
							<div className="grid gap-2">
								<Label>Bit Depth</Label>
								<ButtonBank
									value={target.bitDepth ?? "24"}
									onValueChange={(value) => update({ bitDepth: value as BatchTargetType["bitDepth"] })}
									options={target.format === "wav" ? ["16", "24", "32", "32f"] : ["16", "24"]}
									disabled={disabled}
								/>
							</div>
						)}

						{target.format === "mp3" && (
							<div className="grid gap-2">
								<Label>Bitrate</Label>
								<ButtonBank
									value={target.bitrate ?? "192k"}
									onValueChange={(value) => update({ bitrate: value })}
									options={["128k", "160k", "192k", "224k", "256k", "320k"]}
									disabled={disabled}
								/>
							</div>
						)}

						{target.format === "aac" && (
							<div className="grid gap-2">
								<Label>Bitrate</Label>
								<ButtonBank
									value={target.bitrate ?? "192k"}
									onValueChange={(value) => update({ bitrate: value })}
									options={["64k", "96k", "128k", "160k", "192k", "256k", "320k"]}
									disabled={disabled}
								/>
							</div>
						)}

						<div>
							<div className="mb-2 flex items-baseline justify-between">
								<Label>Concurrency</Label>
								<span className="font-mono text-xs tabular-nums text-muted-foreground">
									{app.batch.concurrency}
								</span>
							</div>
							<Slider
								value={[app.batch.concurrency]}
								onValueChange={(values) => updateConcurrency(values[0] ?? 1)}
								min={1}
								max={MAX_CONCURRENCY}
								step={1}
								ticks={MAX_CONCURRENCY - 1}
								disabled={disabled}
							/>
						</div>
					</div>
				</div>
			</ScrollArea>
		</div>
	);
};
