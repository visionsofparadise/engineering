import { useCallback, useEffect, useState } from "react";
import type { IpcRendererEvent } from "electron";
import type { SessionContext } from "../../../../models/Context";
import type { AudioChainCompleteEvent, AudioProgressEvent } from "../../../../../shared/utilities/emitToRenderer";
import { useActiveSnapshotPath } from "../../hooks/useActiveSnapshotPath";
import type { ExportSettings } from "../ExportModal";

const FORMAT_EXTENSIONS: Record<ExportSettings["format"], string> = {
	wav: "wav",
	flac: "flac",
	mp3: "mp3",
	aac: "m4a",
};

const FORMAT_LABELS: Record<ExportSettings["format"], string> = {
	wav: "WAV Audio",
	flac: "FLAC Audio",
	mp3: "MP3 Audio",
	aac: "AAC Audio",
};

interface ExportState {
	readonly exporting: boolean;
	readonly progress: number;
}

export function useExport(context: SessionContext) {
	const [state, setState] = useState<ExportState>({ exporting: false, progress: 0 });
	const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);
	const activeSnapshotPath = useActiveSnapshotPath(context);

	const tab = context.app.tabs.find((entry) => entry.workingDir === context.sessionPath);
	const defaultName = tab?.label.replace(/\.[^.]+$/, "") ?? "export";

	useEffect(() => {
		if (!activeJobId) return;

		const handleProgress = (_event: IpcRendererEvent, data: AudioProgressEvent) => {
			if (data.jobId !== activeJobId) return;
			const progress = data.sourceTotalFrames ? data.framesProcessed / data.sourceTotalFrames : 0;
			setState((previous) => ({ ...previous, progress: Math.min(1, progress) }));
		};

		const handleComplete = (_event: IpcRendererEvent, data: AudioChainCompleteEvent) => {
			if (data.jobId !== activeJobId) return;
			setState({ exporting: false, progress: 0 });
			setActiveJobId(undefined);
		};

		window.main.events.on("audio:progress", handleProgress);
		window.main.events.on("audio:chainComplete", handleComplete);

		return () => {
			window.main.events.removeListener("audio:progress", handleProgress);
			window.main.events.removeListener("audio:chainComplete", handleComplete);
		};
	}, [activeJobId]);

	const startExport = useCallback(async (settings: ExportSettings) => {
		if (!activeSnapshotPath) return;

		const sourcePath = `${activeSnapshotPath}/audio.wav`;
		const ext = FORMAT_EXTENSIONS[settings.format];

		const targetPath = await context.main.showSaveDialog({
			title: "Export Audio",
			defaultPath: `${defaultName}.${ext}`,
			filters: [{ name: FORMAT_LABELS[settings.format], extensions: [ext] }],
		});

		if (!targetPath) return;

		setState({ exporting: true, progress: 0 });

		const encoding = settings.format === "wav" ? undefined : {
			format: settings.format,
			bitrate: settings.bitrate,
			vbr: settings.vbr,
		};

		const jobId = await context.main.audioApply({
			sourcePath,
			targetPath,
			transforms: [],
			bitDepth: settings.bitDepth,
			encoding,
		});

		setActiveJobId(jobId);
	}, [activeSnapshotPath, context.main, defaultName]);

	return { exporting: state.exporting, progress: state.progress, startExport };
}
