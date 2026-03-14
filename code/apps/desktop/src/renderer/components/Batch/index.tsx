import { resnapshot } from "../../models/ProxyStore/resnapshot";
import { useCallback, useMemo } from "react";
import type { ChainModuleReference } from "audio-chain-module";
import type { IdentifiedChain } from "../../hooks/useChain";
import type { AppContext } from "../../models/Context";
import type { BatchFile } from "../../models/State/App";
import { Button } from "../ui/button";
import { ChainManagerMenu } from "../Session/Chain/ChainManager/ChainManagerMenu";
import { BatchChain } from "./BatchChain";
import { BatchTarget } from "./BatchTarget";
import { FileList } from "./FileList";
import { useBatchExecution } from "./hooks/useBatchExecution";

interface BatchProps {
	readonly context: AppContext;
}

export const Batch: React.FC<BatchProps> = resnapshot(({ context }) => {
	const { app, appStore } = context;

	const { running, start, abortAll, abortFile } = useBatchExecution(app.batch, context);

	const canRun = app.batch.files.length > 0 && app.batch.target.outputDir !== "" && !running;

	const files = app.batch.files;
	const chain: IdentifiedChain = useMemo(
		() => ({
			transforms: (app.batch.transforms as Array<ChainModuleReference>).map((transform) => ({ ...transform, id: crypto.randomUUID() })),
		}),
		[app.batch.transforms],
	);

	const handleAddFiles = useCallback(async () => {
		const paths = await context.main.showOpenDialog({
			title: "Add Files",
			filters: [{ name: "Audio Files", extensions: ["wav", "flac", "mp3", "m4a", "aac", "ogg"] }],
			properties: ["openFile", "multiSelections"],
		});
		if (!paths || paths.length === 0) return;
		const newFiles: Array<BatchFile> = paths.map((filePath) => ({ path: filePath }));
		appStore.mutate(app, (proxy) => {
			proxy.batch.files = [...proxy.batch.files, ...newFiles];
		});
	}, [app, appStore, context.main]);

	const handleClear = useCallback(() => {
		appStore.mutate(app, (proxy) => {
			proxy.batch.files = [];
		});
	}, [app, appStore]);

	const handleChainChange = useCallback(
		(updated: IdentifiedChain) => {
			appStore.mutate(app, (proxy) => {
				proxy.batch.transforms = updated.transforms.map(({ id: _, ...rest }) => rest) as Array<ChainModuleReference>;
			});
		},
		[app, appStore],
	);

	return (
		<div className="flex h-full flex-col p-4">
			{/* Headers row — on the main surface, above the cards */}
			<div className="flex items-end pb-2">
				<div className="flex flex-1 items-center justify-between">
					<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
						Sources ({files.length})
					</span>
					<div className="flex gap-1">
						<Button variant="ghost" size="sm" className="h-7 text-xs" disabled={running} onClick={() => void handleAddFiles()}>
							Add
						</Button>
						<Button variant="ghost" size="sm" className="h-7 text-xs" disabled={running || files.length === 0} onClick={handleClear}>
							Clear
						</Button>
					</div>
				</div>
				<div className="w-8 shrink-0" />
				<div className="flex w-72 shrink-0 items-center justify-between">
					<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
						Chain
					</span>
					<ChainManagerMenu
						chain={chain}
						onChainChange={handleChainChange}
						userDataPath={context.userDataPath}
					/>
				</div>
				<div className="w-8 shrink-0" />
				<div className="flex min-h-7 flex-1 items-center">
					<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
						Target
					</span>
				</div>
			</div>

			{/* Cards row — content with signal flow connectors */}
			<div className="flex flex-1 overflow-hidden">
				{/* Sources card */}
				<div className="card-outline flex flex-1 flex-col overflow-hidden">
					<FileList
						app={app}
						appStore={appStore}
						running={running}
						onAbortFile={abortFile}
						context={context}
					/>
				</div>

				{/* Entry connector — aligns with center of first chain slot */}
				<div className="flex w-8 shrink-0 items-start pt-[1.75rem]">
					<div className="h-px w-full signal-line" />
				</div>

				{/* Chain area with signal line path */}
				<div className="relative flex w-72 shrink-0 flex-col">
					{/* Signal line — entry horizontal from left to center, centered on first slot */}
					<div className="absolute left-0 top-[1.75rem] h-px w-1/2 signal-line" />
					{/* Signal line — vertical connecting entry to exit */}
					<div className="absolute left-1/2 top-[1.75rem] bottom-[1.75rem] w-px -translate-x-1/2 signal-line" />
					{/* Signal line — exit horizontal from center to right, centered on last slot */}
					<div className="absolute right-0 bottom-[1.75rem] h-px w-1/2 signal-line" />
					<BatchChain context={context} disabled={running} />
				</div>

				{/* Exit connector — aligns with center of last chain slot */}
				<div className="flex w-8 shrink-0 items-end pb-[1.75rem]">
					<div className="h-px w-full signal-line" />
				</div>

				{/* Target card */}
				<div className="card-outline flex flex-1 flex-col overflow-hidden">
					<BatchTarget
						app={app}
						appStore={appStore}
						disabled={running}
						context={context}
					/>
				</div>
			</div>

			{/* Run button — bottom right of surface */}
			<div className="flex items-center justify-end gap-2 pt-3">
				{running && (
					<Button variant="destructive" size="sm" className="h-7 text-xs" onClick={abortAll}>
						Abort All
					</Button>
				)}
				<Button className="surface-primary" disabled={!canRun} onClick={start}>
					Run
				</Button>
			</div>
		</div>
	);
});
