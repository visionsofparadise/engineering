import { useCallback, useRef, useState } from "react";
import type { AppContext } from "../../../models/Context";
import type { BatchConfig, BatchFile } from "../../../models/State/App";
import { useJobsState, waitForJobComplete } from "../../../models/State/Jobs";
import { resolveTemplate } from "../../../utils/batchTemplate";

const FORMAT_EXTENSIONS: Record<string, string> = {
	wav: "wav",
	flac: "flac",
	mp3: "mp3",
	aac: "m4a",
};

function encodingFromTarget(target: BatchConfig["target"]): { format: "flac" | "mp3" | "aac"; bitrate?: string; vbr?: number } | undefined {
	if (target.format === "wav") return undefined;
	return { format: target.format, bitrate: target.bitrate, vbr: target.vbr };
}

function parseFileInfo(filePath: string): { name: string; ext: string } {
	const filename = filePath.split(/[\\/]/).pop() ?? filePath;
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex <= 0) return { name: filename, ext: "" };
	return { name: filename.slice(0, dotIndex), ext: filename.slice(dotIndex + 1) };
}

export function useBatchExecution(config: BatchConfig, context: AppContext) {
	const { app, appStore, jobs } = context;
	const [running, setRunning] = useState(false);
	const abortedRef = useRef(false);
	const activeJobIdsRef = useRef(new Set<string>());
	const { startJob } = useJobsState(appStore, jobs);

	const files = app.batch.files;

	const updateFile = useCallback(
		(index: number, update: Partial<BatchFile>) => {
			appStore.mutate(app, (proxy) => {
				const file = proxy.batch.files[index];
				if (!file) return;
				Object.assign(file, update);
			});
		},
		[app, appStore],
	);

	const start = useCallback(async () => {
		setRunning(true);
		abortedRef.current = false;
		activeJobIdsRef.current.clear();

		const { transforms, target, concurrency } = config;
		const ext = FORMAT_EXTENSIONS[target.format] ?? target.format;

		appStore.mutate(app, (proxy) => {
			for (const file of proxy.batch.files) {
				file.jobId = undefined;
			}
		});

		const total = files.length;
		let nextIndex = 0;

		const processFile = async (fileIndex: number): Promise<void> => {
			if (abortedRef.current) return;

			const file = files[fileIndex];
			if (!file) return;

			const fileInfo = parseFileInfo(file.path);
			const resolvedName = resolveTemplate(target.template, fileInfo, fileIndex);
			const targetPath = `${target.outputDir}/${resolvedName}.${ext}`;

			try {
				const jobId = await context.main.audioApply({
					sourcePath: file.path,
					targetPath,
					transforms: [...transforms],
					encoding: encodingFromTarget(target),
					bitDepth: target.bitDepth,
				});

				activeJobIdsRef.current.add(jobId);
				startJob(jobId, [{ moduleName: transforms[0]?.module ?? "apply" }]);
				updateFile(fileIndex, { jobId });

				await waitForJobComplete(jobId);

				activeJobIdsRef.current.delete(jobId);
			} catch {
				// Job failed or aborted — status tracked via JobsState
			}

			if (nextIndex >= total) return;

			const next = nextIndex;
			nextIndex++;

			await processFile(next);
		};

		const initialBatch = Math.min(concurrency, total);
		const promises: Array<Promise<void>> = [];

		for (let index = 0; index < initialBatch; index++) {
			nextIndex = index + 1;
			promises.push(processFile(index));
		}

		nextIndex = initialBatch;

		await Promise.all(promises);

		setRunning(false);
	}, [config, files, context.main, appStore, app, startJob, updateFile]);

	const abortFile = useCallback(
		(index: number) => {
			const file = files[index];
			if (file?.jobId) {
				void context.main.audioAbortJob(file.jobId);
			}
		},
		[files, context.main],
	);

	const abortAll = useCallback(() => {
		abortedRef.current = true;

		for (const jobId of activeJobIdsRef.current) {
			void context.main.audioAbortJob(jobId);
		}
	}, [context.main]);

	return { running, start, abortAll, abortFile };
}
