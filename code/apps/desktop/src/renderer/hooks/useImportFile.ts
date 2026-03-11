import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppContext } from "../models/Context";
import { addTab } from "../utils/tabs";

export function useImportFile(context: AppContext) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (filePath: string) => {
			const { userDataPath } = context;
			const sessionId = crypto.randomUUID();
			const sessionPath = `${userDataPath}/sessions/${sessionId}`;

			await context.main.ensureDirectory(sessionPath);

			await context.main.writeFile(`${sessionPath}/chain.json`, JSON.stringify({ transforms: [] }));

			const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
			const snapshotDir = `${sessionPath}/${timestamp}-source`;
			await context.main.ensureDirectory(snapshotDir);

			await context.main.audioApply({
				sourcePath: filePath,
				transforms: [
					{ package: "acm", module: "waveform", options: { path: `${snapshotDir}/waveform.bin` } },
					{ package: "acm", module: "spectrogram", options: { path: `${snapshotDir}/spectrogram.bin`, frequencyScale: "log" } },
				],
				targetPath: `${snapshotDir}/audio.wav`,
			});

			const tabId = crypto.randomUUID();
			const label = filePath.split(/[\\/]/).pop() ?? "Untitled";

			addTab(
				{
					id: tabId,
					label,
					filePath,
					workingDir: sessionPath,
					activeSnapshotFolder: undefined,
				},
				{ app: context.app, appStore: context.appStore },
			);

			void queryClient.invalidateQueries({ queryKey: ["snapshots", sessionPath] });

			return { sessionPath, tabId };
		},
	});
}
