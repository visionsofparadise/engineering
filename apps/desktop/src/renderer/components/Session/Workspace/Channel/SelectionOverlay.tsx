import { useRef } from "react";
import { useTransients } from "../../../../hooks/useTransients";
import type { SessionContext } from "../../../../models/Context";
import { msToPixels, sampleFrameToMs } from "../../../../utils/time";
import { useMonitoredSnapshotPath } from "../../hooks/useMonitoredSnapshotPath";
import { useWaveformHeader } from "../hooks/useWaveformHeader";

interface SelectionOverlayProps {
	readonly laneHeight: number;
	readonly context: SessionContext;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({ laneHeight, context }) => {
	const { workspace, selection } = context;
	const activeSnapshotPath = useMonitoredSnapshotPath(context);
	const waveformHeader = useWaveformHeader(activeSnapshotPath);
	const sampleRate = waveformHeader?.sampleRate ?? 44100;
	const overlayRef = useRef<HTMLDivElement>(null);

	useTransients([selection.startFrame, selection.endFrame, workspace.pixelsPerSecond, workspace.scrollX], () => {
		const container = overlayRef.current;

		if (!container) return;

		if (!selection.active) {
			container.style.display = "none";

			return;
		}

		const pps = workspace.pixelsPerSecond.value;
		const scrollPx = workspace.scrollX.value;

		const startMs = sampleFrameToMs(selection.startFrame.value, sampleRate);
		const endMs = sampleFrameToMs(selection.endFrame.value, sampleRate);

		const minMs = Math.min(startMs, endMs);
		const maxMs = Math.max(startMs, endMs);

		const leftPx = msToPixels(minMs, pps) - scrollPx;
		const widthPx = msToPixels(maxMs - minMs, pps);

		const channels = selection.channels;

		if (channels.length === 0) {
			container.style.display = "none";

			return;
		}

		const minCh = Math.min(...channels);
		const maxCh = Math.max(...channels);
		const topPx = minCh * laneHeight;
		const heightPx = (maxCh - minCh + 1) * laneHeight;

		container.style.display = "";
		container.style.left = `${leftPx}px`;
		container.style.width = `${widthPx}px`;
		container.style.top = `${topPx}px`;
		container.style.height = `${heightPx}px`;
	});

	return (
		<div
			ref={overlayRef}
			className="pointer-events-none absolute z-10"
			style={{
				display: "none",
				backgroundColor: "rgba(59, 130, 246, 0.3)",
				borderLeft: "1px solid rgba(59, 130, 246, 0.6)",
				borderRight: "1px solid rgba(59, 130, 246, 0.6)",
			}}
		/>
	);
};
