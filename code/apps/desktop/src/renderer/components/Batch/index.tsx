import type { AppContext } from "../../models/Context";
import { Button } from "../ui/button";
import { BatchChain } from "./BatchChain";
import { BatchTarget } from "./BatchTarget";
import { FileList } from "./FileList";
import { useBatchExecution } from "./hooks/useBatchExecution";

interface BatchProps {
	readonly context: AppContext;
}

export const Batch: React.FC<BatchProps> = ({ context }) => {
	const { app, appStore } = context;

	const { running, start, abortAll, abortFile } = useBatchExecution(app.batch, context);

	const canRun = app.batch.files.length > 0 && app.batch.target.outputDir !== "" && !running;

	return (
		<div className="flex h-full flex-col">
			<div className="grid flex-1 grid-cols-3 divide-x divide-border overflow-hidden">
				<FileList
					app={app}
					appStore={appStore}
					running={running}
					onAbortFile={abortFile}
					context={context}
				/>
				<BatchChain
					context={context}
					disabled={running}
				/>
				<BatchTarget
					app={app}
					appStore={appStore}
					disabled={running}
					context={context}
				/>
			</div>
			<div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
				{running && (
					<Button
						variant="destructive"
						size="sm"
						className="h-7 text-xs"
						onClick={abortAll}
					>
						Abort All
					</Button>
				)}
				<Button
					variant="ghost"
					size="sm"
					className="h-7 text-xs"
					disabled={!canRun}
					onClick={start}
				>
					Run
				</Button>
			</div>
		</div>
	);
};
