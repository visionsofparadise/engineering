import { useCallback } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { AppContext } from "../../models/Context";
import type { ProxyStore } from "../../models/ProxyStore/ProxyStore";
import type { AppState, BatchTarget as BatchTargetType } from "../../models/State/App";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface BatchTargetProps {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly disabled: boolean;
	readonly context: AppContext;
}

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

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground">Target</span>
			</div>
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-4 p-3">
					<div className="grid gap-2">
						<Label className="text-xs">Output Directory</Label>
						<div className="flex gap-1">
							<Input
								value={target.outputDir}
								onChange={(event) => update({ outputDir: event.target.value })}
								placeholder="Select output directory..."
								className="h-7 flex-1 text-xs"
								disabled={disabled}
							/>
							<Button
								variant="outline"
								size="sm"
								className="h-7 text-xs"
								disabled={disabled}
								onClick={() => void handleBrowse()}
							>
								Browse
							</Button>
						</div>
					</div>

					<div className="grid gap-2">
						<Label className="text-xs">Filename Template</Label>
						<Input
							value={target.template}
							onChange={(event) => update({ template: event.target.value })}
							placeholder="{name}"
							className="h-7 text-xs"
							disabled={disabled}
						/>
						<p className="text-[10px] text-muted-foreground">
							Variables: {"{name}"}, {"{ext}"}, {"{index}"}, {"{index:N}"}
						</p>
					</div>

					<div className="grid gap-2">
						<Label className="text-xs">Format</Label>
						<div className="flex gap-1">
							{(["wav", "flac", "mp3", "aac"] as const).map((fmt) => (
								<Button
									key={fmt}
									variant={target.format === fmt ? "default" : "outline"}
									size="sm"
									className="h-7 flex-1 text-xs uppercase"
									disabled={disabled}
									onClick={() => update({ format: fmt })}
								>
									{fmt}
								</Button>
							))}
						</div>
					</div>

					{(target.format === "wav" || target.format === "flac") && (
						<div className="grid gap-2">
							<Label className="text-xs">Bit Depth</Label>
							<Select
								value={target.bitDepth ?? "24"}
								onValueChange={(value) => update({ bitDepth: value as BatchTargetType["bitDepth"] })}
								disabled={disabled}
							>
								<SelectTrigger className="h-7 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="16">16-bit</SelectItem>
									<SelectItem value="24">24-bit</SelectItem>
									{target.format === "wav" && <SelectItem value="32">32-bit</SelectItem>}
									{target.format === "wav" && <SelectItem value="32f">32-bit float</SelectItem>}
								</SelectContent>
							</Select>
						</div>
					)}

					{target.format === "mp3" && (
						<div className="grid gap-2">
							<Label className="text-xs">Bitrate</Label>
							<Select
								value={target.bitrate ?? "192k"}
								onValueChange={(value) => update({ bitrate: value })}
								disabled={disabled}
							>
								<SelectTrigger className="h-7 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{["128k", "160k", "192k", "224k", "256k", "320k"].map((br) => (
										<SelectItem key={br} value={br}>{br}</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					{target.format === "aac" && (
						<div className="grid gap-2">
							<Label className="text-xs">Bitrate</Label>
							<Select
								value={target.bitrate ?? "192k"}
								onValueChange={(value) => update({ bitrate: value })}
								disabled={disabled}
							>
								<SelectTrigger className="h-7 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{["64k", "96k", "128k", "160k", "192k", "256k", "320k"].map((br) => (
										<SelectItem key={br} value={br}>{br}</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					<div className="grid gap-2">
						<Label className="text-xs">Concurrency</Label>
						<Input
							type="number"
							value={app.batch.concurrency}
							onChange={(event) => updateConcurrency(Number(event.target.value))}
							min={1}
							className="h-7 text-xs"
							disabled={disabled}
						/>
					</div>
				</div>
			</ScrollArea>
		</div>
	);
};
